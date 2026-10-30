## Embed missing transcripts into corpus.json

Two transcript files are mapped but NOT yet embedded:
  - Athena Intelligence (id=2)  → 9 chunks
  - CrushBank / From Weeks to Days (id=30) → 18 chunks

Run these PowerShell commands from the btb-chat-api directory:

```powershell
# 1. Set your credentials
$env:WATSONX_API_KEY    = 'YOUR_WATSONX_API_KEY'
$env:WATSONX_PROJECT_ID = 'YOUR_WATSONX_PROJECT_ID'
$env:WATSONX_URL        = 'https://us-south.ml.cloud.ibm.com'
$env:TRANSCRIPTS_DIR    = 'C:\Users\SampreethKumar\Downloads\CVPE\Video Transcripts_Roses'

# 2. Run the transcript builder (appends to corpus.json, skips already-embedded chunks)
cd C:\Users\SampreethKumar\Desktop\btb-chat-api
node build-transcripts.js

# 3. Commit and push the updated corpus.json
git add corpus.json
git commit -m "corpus: add Athena Intelligence + CrushBank Legacy Data transcript chunks"
git push origin main

# Then rebuild and redeploy on IBM Cloud Code Engine (see README).
```

Expected output:
  storyId=2 (Athena Intelligence) … 9 chunks
  storyId=30 (CrushBank) … 18 chunks
  27 new chunks to embed.
  … 27 embedded, 0 skipped.
  ✅ corpus.json updated: 172 → 199 chunks
