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

2. Create a `.env` file in your repository:
```env
COOKBOOK_URL=your_cookbook_gist_url
```

3. Create `.github/workflows/dependency-validator.yml`:

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
          COOKBOOK_URL: ${{ secrets.COOKBOOK_URL }} # Load from repository secrets
```

## Configuration Options

- `OPENAI_API_MODEL`: GPT model to use (default: "gpt-4")
- `exclude`: Comma-separated glob patterns for files to ignore
- `COOKBOOK_URL`: URL to your validation rules cookbook (loaded from .env)

## Environment Variables

Create these secrets in your GitHub repository:

- `OPENAI_API_KEY`: Your OpenAI API key
- `COOKBOOK_URL`: URL to your validation rules cookbook

## How It Works

1. Monitors pull request events (open/sync)
2. Loads configuration from .env and secrets
3. Analyzes changed files based on type:
   - For dependency files: Validates version pinning
   - For database files: Checks migration standards
4. Provides structured feedback with:
   - Issue type classification
   - Severity level (Critical/Warning/Info)
   - Specific problems found
   - Required solutions
   - Code examples
5. Adds review comments directly to the PR

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
2. Create a `.env` file with your configuration:
```env
COOKBOOK_URL=your_cookbook_gist_url
```
3. Install dependencies:
```bash
npm install
```
4. Build the project:
```bash
npm run build
npm run package
```
```

For the workflow file, here's the updated version:

```yaml:.github/workflows/dependency-validation.yml
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
      - name: Checkout repository
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '16'

      - name: Install dependencies
        run: |
          npm install
          npm install p-limit@3.1.0

      - name: Validate Dependencies & Migrations
        uses: ./
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          COOKBOOK_URL: ${{ secrets.COOKBOOK_URL }}
          exclude: "*.md,*.txt"
```

And for the action.yml:

```yaml:action.yml
name: "AI Dependency & Migration Validator"
description: "Validate dependency versioning and database migrations using AI"
inputs:
  GITHUB_TOKEN:
    description: "GitHub token to interact with the repository"
    required: true
  OPENAI_API_KEY:
    description: "OpenAI API key for GPT"
    required: true
  OPENAI_API_MODEL:
    description: "OpenAI API model"
    required: false
    default: "gpt-4"
  exclude:
    description: "Glob patterns to exclude files from analysis"
    required: false
    default: ""
  COOKBOOK_URL:
    description: "URL to fetch validation rules cookbook from"
    required: true
runs:
  using: "node16"
  main: "dist/src/main.js"
branding:
  icon: "shield"
  color: "blue"