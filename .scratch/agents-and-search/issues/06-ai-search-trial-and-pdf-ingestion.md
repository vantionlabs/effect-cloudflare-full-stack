# Measure AI Search against pgvector; read PDFs

Status: needs-triage
Type: research

Run the retrieval gold set through an AI Search instance (hybrid, reranking on) and record recall@3 beside ours in
`docs/references.md`. Independently: PDF and scanned manuals — either AI Search's managed ingestion or Workers AI's
markdown conversion feeding our own chunker. Decide by the numbers; write the outcome as an ADR either way.
