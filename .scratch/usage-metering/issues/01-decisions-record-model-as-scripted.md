# Every decision row says `model = 'scripted'`

Status: needs-triage

`settleDecision` inserts `decisions.model` as the literal `'scripted'` (`DecideSteps.ts`), whichever model
actually decided. Found while metering: the adapter now reports its model id as `response-metadata`, and
`usage_records` labels token rows with the real model — so the meter knows which model decided and the
decision's own audit row does not. An auditor reading `decisions` a year later would be told every decision was
made by the test double.

Fix: carry `modelUsageOf(response)?.model` out of the decide step into `settleDecision`, falling back to the
literal only when the model did not report one.
