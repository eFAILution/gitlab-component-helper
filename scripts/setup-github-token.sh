#!/bin/bash

echo "🔑 Setting up GitHub Token for Semantic-Release"
echo "=============================================="
echo ""
echo "1. Create a GitHub Personal Access Token:"
echo "   → Go to: https://github.com/settings/tokens"
echo "   → Click 'Generate new token (classic)'"
echo "   → Select scope: 'repo' (full control of private repositories)"
echo "   → Copy the token"
echo ""
echo "2. Setup .env file:"

if [ -f .env ]; then
  echo "   ⚠️  .env file already exists"
  echo "   → Edit .env and update GITHUB_TOKEN=your_token_here"
else
  echo "   → Creating .env file from template..."
  cp .env.example .env
  echo "   ✅ Created .env file"
  echo "   → Edit .env and replace 'your_github_token_here' with your actual token"
fi

echo ""
echo "3. Test your token setup (dry run - no changes made):"
echo "   → npm run semantic-release:env-dry         (test full semantic-release)"
echo "   → npm run semantic-release:env-only-dry    (test local-only semantic-release)"
echo ""
echo "4. Available commands once token is verified:"
echo "   → npm run semantic-release:env         (full semantic-release)"
echo "   → npm run semantic-release:env-only    (local-only semantic-release)"
echo ""
echo "💡 Your token will be kept secure and gitignored!"
echo "💡 Alternative: Use 'npm run release:manual' (no token needed)"
