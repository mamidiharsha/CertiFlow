CREATE UNIQUE INDEX "approvals_one_current_decision_per_user_stage_key"
ON "approvals" ("batch_id", "user_id", "stage")
WHERE "superseded" = false;
