# AI Dependency & Migration Validator

A GitHub Action that uses OpenAI's GPT models to automatically validate dependency versions and database migration standards in your pull requests.

## Key Features

- 📦 **Dependency Version Validation**
  - package.json version pinning
  - Dockerfile base image versions
  - GitHub Actions version tags

- 🗄️ **Database Migration Validation**
  - Transaction wrapping
  - Rollback support
  - Data safety practices

## Setup

1. Add your OpenAI API key as a GitHub Secret named `OPENAI_API_KEY`

2. Create `.github/workflows/dependency-validator.yml`:

```yaml
name: Dependency & Migration Validator

on:
  pull_request:
    types:
      - opened
      - synchronize

permissions: write-all

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: AI Validator
        uses: your-username/ai-dependency-validator@main
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          OPENAI_API_MODEL: "gpt-4" # Optional: defaults to gpt-4
          exclude: "*.md,*.txt,*.log" # Optional: files to exclude
```

## Configuration Options

- `OPENAI_API_MODEL`: GPT model to use (default: "gpt-4")
- `exclude`: Comma-separated glob patterns for files to ignore

## How It Works

1. Monitors pull request events (open/sync)
2. Analyzes changed files based on type:
   - For dependency files: Validates version pinning
   - For database files: Checks migration standards
3. Provides structured feedback with:
   - Issue type classification
   - Severity level (Critical/Warning/Info)
   - Specific problems found
   - Required solutions
   - Code examples
4. Adds review comments directly to the PR

## Response Format

Each review comment follows this structure:

```
🏷️ ISSUE TYPE: [Version Pinning|Migration Safety]
⚠️ SEVERITY: [🔴 Critical|🟡 Warning|🟢 Info]
❌ PROBLEM: [Specific issue found]
✅ SOLUTION: [Exact fix required]
📝 EXAMPLE: [Code example of correct implementation]
```

## Development

1. Clone the repository
2. Install dependencies:
```bash
npm install
```
3. Build the project:
```bash
npm run build
npm run package
```