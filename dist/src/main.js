"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const core = __importStar(require("@actions/core"));
const openai_1 = __importDefault(require("openai"));
const rest_1 = require("@octokit/rest");
const parse_diff_1 = __importDefault(require("parse-diff"));
const minimatch_1 = __importDefault(require("minimatch"));
const patterns_1 = require("./patterns");
const p_limit_1 = __importDefault(require("p-limit"));
const GITHUB_TOKEN = core.getInput("GITHUB_TOKEN");
const OPENAI_API_KEY = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL = "gpt-4o-2024-08-06";
const COOKBOOK_URL = core.getInput("COOKBOOK_URL");
const octokit = new rest_1.Octokit({ auth: GITHUB_TOKEN });
const openai = new openai_1.default({
    apiKey: OPENAI_API_KEY,
});
function getPRDetails() {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const { repository, number } = JSON.parse((0, fs_1.readFileSync)(process.env.GITHUB_EVENT_PATH || "", "utf8"));
        const prResponse = yield octokit.pulls.get({
            owner: repository.owner.login,
            repo: repository.name,
            pull_number: number,
        });
        return {
            owner: repository.owner.login,
            repo: repository.name,
            pull_number: number,
            title: (_a = prResponse.data.title) !== null && _a !== void 0 ? _a : "",
            description: (_b = prResponse.data.body) !== null && _b !== void 0 ? _b : "",
        };
    });
}
const logPrefix = {
    info: "🔍",
    warning: "⚠️",
    success: "✅",
    error: "❌",
    debug: "🐛",
    review: "📝"
};
function analyzeCodeParallel(parsedDiff, prDetails, cookbook) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`🔍 Analyzing ${parsedDiff.length} files in parallel`);
        const limit = (0, p_limit_1.default)(5);
        const filePromises = parsedDiff.map(file => limit(() => __awaiter(this, void 0, void 0, function* () {
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
            const chunkPromises = file.chunks.map((chunk, index) => __awaiter(this, void 0, void 0, function* () {
                console.log(`📝 Analyzing chunk ${index + 1}/${file.chunks.length} in ${file.to}`);
                const prompt = createPrompt({
                    file,
                    chunk,
                    prDetails,
                    fileType,
                    cookbook
                });
                const aiResponse = yield getAIResponse(prompt);
                if (!aiResponse) {
                    console.log(`⚠️ No AI response for chunk ${index + 1} in ${file.to}`);
                    return [];
                }
                return createStructuredComment(file, aiResponse);
            }));
            const chunkResults = yield Promise.all(chunkPromises);
            return chunkResults.flat();
        })));
        const results = yield Promise.all(filePromises);
        console.log(`✅ Analysis complete. Found ${results.flat().length} issues`);
        return results.flat();
    });
}
function getFileType(filename) {
    if (patterns_1.FilePatterns.dependency.patterns.some(pattern => (0, minimatch_1.default)(filename, pattern)) ||
        patterns_1.FilePatterns.dependency.fileTypes.some(ext => filename.endsWith(ext))) {
        return 'dependency';
    }
    if (patterns_1.FilePatterns.migration.patterns.some(pattern => (0, minimatch_1.default)(filename, pattern)) ||
        patterns_1.FilePatterns.migration.fileTypes.some(ext => filename.endsWith(ext))) {
        return 'migration';
    }
    return 'ignored';
}
function createPrompt({ file, chunk, prDetails, fileType, cookbook }) {
    const systemMessage = `🤖 AI Dependency & Migration Validator v2.0

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
    // Rest of the function remains the same
    const userMessage = `Review this diff in "${file.to}":...`;
    return { system: systemMessage, user: userMessage };
}
function getAIResponse(prompt) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🤖 Sending request to OpenAI');
        const queryConfig = {
            model: OPENAI_API_MODEL,
            temperature: 0.3,
            max_tokens: 1000,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: prompt.system
                },
                {
                    role: "user",
                    content: prompt.user
                }
            ]
        };
        try {
            const response = yield openai.chat.completions.create(queryConfig);
            const content = ((_b = (_a = response.choices[0].message) === null || _a === void 0 ? void 0 : _a.content) === null || _b === void 0 ? void 0 : _b.trim()) || "{}";
            console.log('📥 Raw AI response:', content);
            try {
                const parsed = JSON.parse(content);
                console.log('✅ Successfully parsed AI response');
                return parsed;
            }
            catch (parseError) {
                console.error('❌ Failed to parse AI response:', parseError);
                console.log('📄 Problematic content:', content);
                return null;
            }
        }
        catch (error) {
            console.error("❌ OpenAI API error:", error);
            return null;
        }
    });
}
function createStructuredComment(file, aiResponse) {
    if (!file.to)
        return [];
    const filePath = file.to; // Capture the non-null value
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
function createReviewComment(owner, repo, pull_number, comments) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`${logPrefix.review} Preparing to post ${comments.length} review comments`);
        try {
            // First, get the diff to map line numbers to positions
            const diff = yield getDiff(owner, repo, pull_number);
            const parsedDiff = (0, parse_diff_1.default)(diff);
            // Create a map of file paths to their diff positions
            const diffPositions = new Map();
            parsedDiff.forEach(file => {
                const positions = [];
                let position = 0;
                file.chunks.forEach(chunk => {
                    chunk.changes.forEach(change => {
                        position++;
                        if (change.type !== 'del') { // Only track additions and normal lines
                            positions.push({
                                path: file.to || '',
                                position: position,
                                line: 'ln2' in change ? change.ln2 : change.ln,
                            });
                        }
                    });
                });
                diffPositions.set(file.to || '', positions);
            });
            // Filter and map comments to valid diff positions
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
            }).filter((comment) => comment !== null);
            if (validComments.length === 0) {
                console.log(`${logPrefix.warning} No valid diff positions found for any comments`);
                return;
            }
            console.log(`${logPrefix.review} Posting ${validComments.length} comments (${comments.length - validComments.length} skipped)`);
            yield octokit.pulls.createReview({
                owner,
                repo,
                pull_number,
                event: "COMMENT",
                comments: validComments
            });
            console.log(`${logPrefix.success} Successfully posted review comments`);
        }
        catch (error) {
            console.error(`${logPrefix.error} Error posting review:`, error);
            // Log detailed information about the comments for debugging
            console.log(`${logPrefix.debug} Attempted to post comments:`, comments.map(c => ({
                path: c.path,
                line: c.line,
                bodyLength: c.body.length
            })));
            throw error;
        }
    });
}
function getDiff(owner, repo, pull_number) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield octokit.pulls.get({
            owner,
            repo,
            pull_number,
            mediaType: {
                format: "diff"
            }
        });
        const diff = response.data;
        return diff;
    });
}
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
function fetchCookbook(url) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!url) {
                console.log('ℹ️ No cookbook URL provided, using default rules');
                return defaultRules;
            }
            console.log(`📥 Fetching cookbook from: ${url}`);
            const response = yield fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch cookbook: ${response.statusText}`);
            }
            const rules = yield response.text();
            console.log('✅ Successfully fetched cookbook rules');
            return rules;
        }
        catch (error) {
            console.error('❌ Error fetching cookbook:', error);
            console.log('⚠️ Falling back to default rules');
            return defaultRules;
        }
    });
}
function main() {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🚀 Starting validation process');
        try {
            const prDetails = yield getPRDetails();
            console.log(`📋 Analyzing PR #${prDetails.pull_number} in ${prDetails.owner}/${prDetails.repo}`);
            // Fetch cookbook rules early
            console.log('📚 Fetching validation cookbook...');
            const cookbook = yield fetchCookbook(COOKBOOK_URL);
            console.log('✅ Cookbook loaded successfully');
            let diff;
            const eventData = JSON.parse((0, fs_1.readFileSync)((_a = process.env.GITHUB_EVENT_PATH) !== null && _a !== void 0 ? _a : "", "utf8"));
            if (eventData.action === "opened") {
                diff = yield getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number);
            }
            else if (eventData.action === "synchronize") {
                const newBaseSha = eventData.before;
                const newHeadSha = eventData.after;
                const response = yield octokit.repos.compareCommits({
                    headers: {
                        accept: "application/vnd.github.v3.diff",
                    },
                    owner: prDetails.owner,
                    repo: prDetails.repo,
                    base: newBaseSha,
                    head: newHeadSha,
                });
                diff = String(response.data);
            }
            else {
                console.log("Unsupported event:", process.env.GITHUB_EVENT_NAME);
                return;
            }
            if (!diff) {
                console.log("❌ No diff found");
                return;
            }
            const parsedDiff = (0, parse_diff_1.default)(diff);
            const excludePatterns = core
                .getInput("exclude")
                .split(",")
                .map((s) => s.trim());
            const filteredDiff = parsedDiff.filter((file) => {
                return !excludePatterns.some((pattern) => { var _a; return (0, minimatch_1.default)((_a = file.to) !== null && _a !== void 0 ? _a : "", pattern); });
            });
            // Pass cookbook to analyzeCodeParallel
            const comments = yield analyzeCodeParallel(filteredDiff, prDetails, cookbook);
            console.log(`💬 Generated ${comments.length} comments`);
            if (comments.length > 0) {
                console.log('📤 Posting review comments');
                yield createReviewComment(prDetails.owner, prDetails.repo, prDetails.pull_number, comments);
                console.log('✅ Review comments posted successfully');
            }
        }
        catch (error) {
            console.error('❌ Main process error:', error);
            throw error;
        }
    });
}
main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
//# sourceMappingURL=main.js.map