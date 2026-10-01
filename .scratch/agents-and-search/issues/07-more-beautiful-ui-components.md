# More Beautiful UI components, with real data only

Status: resolved
Type: task

Not yet used, and where each earns its place:

- ChatComposer + StreamingText → Ask conversations (issue 01).
- SearchList → a ⌘K command palette: pages, customers, quotes, documents.
- TaskRows → Planning: each job with its invoice lines.
- InsightCards (AllocationCard only, no liveline smoothing) → Usage token share per model; Planning cash out by expense.
- Flowchart → the queue inspector: the decision's pipeline as it actually ran (issue 05).
- PromptBar (demo off, fake sources/models removed) → the Insights question box.
- RecordsTable (resize/sort only) → the price list.
- ApprovalCard → stepper for multi-step flows if one appears; weak fit today.
  Rule as always: strip demo data and timers, mark LOCAL CHANGE.

## Answer

Done in 2fea0dace: ⌘K palette (SearchList), AllocationCard (planning, usage), ChatComposer + StreamingText (Ask),
DataTable sorting. Declined, with reasons in the commit: TaskRows (hides actions, implies live activity), PromptBar
(everything beyond the text box is fake for us), RecordsTable (fixed CRM shape; sortable DataTable instead).
