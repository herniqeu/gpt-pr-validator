import { readFileSync } from "fs";
import * as core from "@actions/core";
import OpenAI from "openai";
import { Octokit } from "@octokit/rest";
import parseDiff, { Chunk, File } from "parse-diff";
import minimatch from "minimatch";
import { FilePatterns } from './patterns';
import pLimit from 'p-limit';

const GITHUB_TOKEN: string = core.getInput("GITHUB_TOKEN");
const OPENAI_API_KEY: string = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL: string = "gpt-4o-2024-08-06";
const COOKBOOK_URL: string = core.getInput("COOKBOOK_URL");

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

interface PRDetails {
  owner: string;
  repo: string;
  pull_number: number;
  title: string;
  description: string;
}

interface ValidationReview {
  lineNumber: number;
  issueType: 'Version Pinning' | 'Migration Safety';
  severity: '🔴 Critical' | '🟡 Warning' | '🟢 Info';
  problem: string;
  solution: string;
  example: string;
}

interface AIResponse {
  reviews: ValidationReview[];
  verdict: {
    status: 'APPROVED' | 'CHANGES_NEEDED' | 'BLOCKED';
    details: string[];
  };
}

interface DiffPosition {
  path: string;
  position: number; 
  line: number;   
}

interface DiffChange {
  type: 'add' | 'del' | 'normal';
  ln?: number;   
  ln1?: number;  
  ln2?: number;  
  content: string;
}

interface DiffChunk {
  changes: DiffChange[];
  content: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

interface DiffFile {
  to: string | null;
  chunks: DiffChunk[];
}

async function getPRDetails(): Promise<PRDetails> {
  const { repository, number } = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8")
  );
  const prResponse = await octokit.pulls.get({
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
  });
  return {
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
    title: prResponse.data.title ?? "",
    description: prResponse.data.body ?? "",
  };
}

const logPrefix = {
  info: "🔍",
  warning: "⚠️",
  success: "✅",
  error: "❌",
  debug: "🐛",
  review: "📝"
};

const defaultRules = `ANALYZE ONLY THE FOLLOWING BASED ON FILE TYPE:

📦 FOR DEPENDENCY FILES (package.json, Dockerfile, *.yml):
Check ONLY version pinning issues:
1. package.json:
   ❌ "^1.0.0", "~1.0.0", "*", "latest"
   ✅ "1.0.0" (exact version only)
   
2. Dockerfile:
   ❌ FROM node, FROM node:latest
   ✅ FROM node:18.17.1
   
3. GitHub Actions:
   ❌ actions/checkout@v3, actions/checkout@main
   ✅ actions/checkout@v3.1.2

🗄️ FOR DATABASE FILES (*.sql, *migration*, *.db):
Check ONLY migration standards:
1. Transaction Wrapping:
   ❌ Direct ALTER/CREATE statements
   ✅ BEGIN TRANSACTION; ... COMMIT;
   
2. Rollback Support:
   ❌ Missing DOWN migration
   ✅ Paired UP/DOWN migrations
   
3. Data Safety:
   ❌ Direct column drops, type changes
   ✅ Safe multi-step migrations`;

async function analyzeCodeParallel(
  parsedDiff: File[],
  prDetails: PRDetails,
  cookbook: string
): Promise<Array<{ body: string; path: string; line: number }>> {
  console.log(`🔍 Analyzing ${parsedDiff.length} files in parallel`);
  const limit = pLimit(5);
  
  const filePromises = parsedDiff.map(file => 
    limit(async () => {
      if (!file.to || file.to === "/dev/null") {
        console.log(`⏭️ Skipping invalid file path: ${file.to}`);
        return [];
      }
      
      const fileType = getFileType(file.to);
      console.log(`📁 Processing ${file.to} (Type: ${fileType})`);
      
      if (fileType === 'ignored') {
        console.log(`⏭️ Skipping ignored file: ${file.to}`);
        return [];
      }

      const chunkPromises = file.chunks.map(async (chunk, index) => {
        console.log(`📝 Analyzing chunk ${index + 1}/${file.chunks.length} in ${file.to}`);
        const prompt = createPrompt({ 
          file,
          chunk,
          prDetails,
          fileType,
          cookbook 
        });
        const aiResponse = await getAIResponse(prompt);
        
        if (!aiResponse) {
          console.log(`⚠️ No AI response for chunk ${index + 1} in ${file.to}`);
          return [];
        }
        
        return createStructuredComment(file, aiResponse);
      });

      const chunkResults = await Promise.all(chunkPromises);
      return chunkResults.flat();
    })
  );

  const results = await Promise.all(filePromises);
  console.log(`✅ Analysis complete. Found ${results.flat().length} issues`);
  return results.flat();
}

function getFileType(filename: string): 'dependency' | 'migration' | 'ignored' {
  if (FilePatterns.dependency.patterns.some(pattern => minimatch(filename, pattern)) ||
      FilePatterns.dependency.fileTypes.some(ext => filename.endsWith(ext))) {
    return 'dependency';
  }
  
  if (FilePatterns.migration.patterns.some(pattern => minimatch(filename, pattern)) ||
      FilePatterns.migration.fileTypes.some(ext => filename.endsWith(ext))) {
    return 'migration';
  }

  return 'ignored';
}

interface PromptConfig {
  file: File;
  chunk: Chunk;
  prDetails: PRDetails;
  fileType: 'dependency' | 'migration';
  cookbook: string;
}

function createPrompt({ file, chunk, prDetails, fileType, cookbook }: PromptConfig): { system: string, user: string } {
  const systemMessage = `

${cookbook}

RESPONSE FORMAT:
{
  "reviews": [{
    "lineNumber": <number>,
    "issueType": "Version Pinning|Migration Safety",
    "severity": "🔴 Critical|🟡 Warning|🟢 Info",
    "problem": "Specific issue found",
    "solution": "Exact fix required",
    "example": "Code example of correct implementation"
  }],
  "verdict": {
    "status": "APPROVED|CHANGES_NEEDED|BLOCKED",
    "details": ["List of specific items"]
  }
}

IMPORTANT RULES:
1. ONLY analyze version pinning OR migrations based on file type
2. EVERY comment MUST follow the exact response format
3. ALWAYS include severity level and specific fix
4. ALWAYS end with a final verdict
5. BE CONCISE - no explanatory text, only structured feedback`;

  const userMessage = `Review this diff in "${file.to}":...`;
  return { system: systemMessage, user: userMessage };
}

async function getAIResponse(prompt: { system: string, user: string }): Promise<AIResponse | null> {
  console.log('🤖 Sending request to OpenAI');
  
  const queryConfig = {
    model: OPENAI_API_MODEL,
    temperature: 0.3,
    max_tokens: 1000,
    response_format: { type: "json_object" as const },
    messages: [
      {
        role: "system" as const,
        content: prompt.system
      },
      {
        role: "user" as const,
        content: prompt.user
      }
    ]
  };

  try {
    const response = await openai.chat.completions.create(queryConfig);
    const content = response.choices[0].message?.content?.trim() || "{}";
    console.log('📥 Raw AI response:', content);

    try {
      const parsed = JSON.parse(content) as AIResponse;
      console.log('✅ Successfully parsed AI response');
      return parsed;
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', parseError);
      console.log('📄 Problematic content:', content);
      return null;
    }
  } catch (error) {
    console.error("❌ OpenAI API error:", error);
    return null;
  }
}

function createStructuredComment(
  file: File,
  aiResponse: AIResponse
): Array<{ body: string; path: string; line: number }> {
  if (!file.to) return [];
  const filePath = file.to;  // Capture the non-null value
  return aiResponse.reviews.map(review => ({
    body: `🏷️ ISSUE TYPE: ${review.issueType}
⚠️ SEVERITY: ${review.severity}
❌ PROBLEM: ${review.problem}
✅ SOLUTION: ${review.solution}
📝 EXAMPLE: ${review.example}`,
    path: filePath, 
    line: review.lineNumber,
  }));
}

async function createReviewComment(
  owner: string,
  repo: string,
  pull_number: number,
  comments: Array<{ body: string; path: string; line: number }>
): Promise<void> {
  console.log(`${logPrefix.review} Preparing to post ${comments.length} review comments`);

  try {

    const diff = await getDiff(owner, repo, pull_number);
    const parsedDiff = parseDiff(diff);
    
    const diffPositions = new Map<string, DiffPosition[]>();
    
    parsedDiff.forEach(file => {
      const positions: DiffPosition[] = [];
      let position = 0;
      
      file.chunks.forEach(chunk => {
        chunk.changes.forEach(change => {
          position++;
          if (change.type !== 'del') { 
            positions.push({
              path: file.to || '',
              position: position,
              line: 'ln2' in change ? change.ln2! : change.ln!,
            });
          }
        });
      });
      
      diffPositions.set(file.to || '', positions);
    });

    const validComments = comments.map(comment => {
      const filePositions = diffPositions.get(comment.path);
      if (!filePositions) {
        console.log(`${logPrefix.warning} No diff positions found for file: ${comment.path}`);
        return null;
      }

      const diffPosition = filePositions.find(pos => pos.line === comment.line);
      if (!diffPosition) {
        console.log(`${logPrefix.warning} No diff position found for line ${comment.line} in ${comment.path}`);
        return null;
      }

      return {
        path: comment.path,
        body: comment.body,
        position: diffPosition.position
      };
    }).filter((comment): comment is NonNullable<typeof comment> => comment !== null);

    if (validComments.length === 0) {
      console.log(`${logPrefix.warning} No valid diff positions found for any comments`);
      return;
    }

    console.log(`${logPrefix.review} Posting ${validComments.length} comments (${comments.length - validComments.length} skipped)`);

    await octokit.pulls.createReview({
      owner,
      repo,
      pull_number,
      event: "COMMENT",
      comments: validComments
    });

    console.log(`${logPrefix.success} Successfully posted review comments`);
  } catch (error) {
    console.error(`${logPrefix.error} Error posting review:`, error);
    
    console.log(`${logPrefix.debug} Attempted to post comments:`, 
      comments.map(c => ({
        path: c.path,
        line: c.line,
        bodyLength: c.body.length
      }))
    );
    
    throw error;
  }
}

async function getDiff(owner: string, repo: string, pull_number: number): Promise<string> {
  
  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: {
      format: "diff"
    }
  });

  const diff = response.data as unknown as string;
  
  return diff;
}

async function fetchCookbook(url: string): Promise<string> {
  try {
    if (!url) {
      console.log('ℹ️ No cookbook URL provided, using default rules');
      return defaultRules;
    }

    console.log(`📥 Fetching cookbook from: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch cookbook: ${response.statusText}`);
    }
    const rules = await response.text();
    console.log('✅ Successfully fetched cookbook rules');
    return rules;
  } catch (error) {
    console.error('❌ Error fetching cookbook:', error);
    console.log('⚠️ Falling back to default rules');
    return defaultRules;
  }
}

async function main() {
  console.log('🚀 Starting validation process');
  try {
    const prDetails = await getPRDetails();
    console.log(`📋 Analyzing PR #${prDetails.pull_number} in ${prDetails.owner}/${prDetails.repo}`);
    
    console.log('📚 Fetching validation cookbook...');
    const cookbook = await fetchCookbook(COOKBOOK_URL);
    console.log('✅ Cookbook loaded successfully');

    let diff: string | null;
    const eventData = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")
    );

    if (eventData.action === "opened") {
      diff = await getDiff(
        prDetails.owner,
        prDetails.repo,
        prDetails.pull_number
      );
    } else if (eventData.action === "synchronize") {
      const newBaseSha = eventData.before;
      const newHeadSha = eventData.after;

      const response = await octokit.repos.compareCommits({
        headers: {
          accept: "application/vnd.github.v3.diff",
        },
        owner: prDetails.owner,
        repo: prDetails.repo,
        base: newBaseSha,
        head: newHeadSha,
      });

      diff = String(response.data);
    } else {
      console.log("Unsupported event:", process.env.GITHUB_EVENT_NAME);
      return;
    }

    if (!diff) {
      console.log("❌ No diff found");
      return;
    }
    
    const parsedDiff = parseDiff(diff);

    const excludePatterns = core
      .getInput("exclude")
      .split(",")
      .map((s) => s.trim());

    const filteredDiff = parsedDiff.filter((file: File) => {
      return !excludePatterns.some((pattern: string) =>
        minimatch(file.to ?? "", pattern)
      );
    });

    const comments = await analyzeCodeParallel(filteredDiff, prDetails, cookbook);
    console.log(`💬 Generated ${comments.length} comments`);
    
    if (comments.length > 0) {
      console.log('📤 Posting review comments');
      await createReviewComment(
        prDetails.owner,
        prDetails.repo,
        prDetails.pull_number,
        comments
      );
      console.log('✅ Review comments posted successfully');
    }
  } catch (error) {
    console.error('❌ Main process error:', error);
    throw error;
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
