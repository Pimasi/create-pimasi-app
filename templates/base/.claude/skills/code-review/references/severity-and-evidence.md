# Severity and evidence standard

Separate impact from confidence. A frightening hypothesis is not a critical
finding, and incomplete evidence does not make a proven defect low impact.

## Evidence strength

Prefer evidence in this order:

1. A deterministic reproduction or focused failing test against the reviewed
   tree.
2. A complete source/data-flow trace tied to an authoritative contract or
   invariant.
3. A directly applicable repository rule, versioned API contract, compiler or
   static-analysis failure.
4. A consistent pattern in adjacent code, history, logs, or broader test output.
5. Scanner output, an agent hand-off, a sub-reviewer claim, or intuition.

Levels 4 and 5 normally generate investigation leads, not findings. Never claim a
command passed or failed unless the reviewer ran it against the stated tree and
environment.

## Severity

- **P0 — Critical:** A reachable path enables severe privilege compromise,
  broad secret exposure, irreversible or widespread data loss, unsafe financial
  fulfilment, or a systemic outage requiring immediate stop-ship action.
- **P1 — High:** A plausible supported path breaks core correctness, security,
  compatibility, deployment, or durable data for a material set of users.
- **P2 — Medium:** A real defect has a bounded trigger or blast radius but causes
  incorrect behaviour, failed recovery, misleading operation, or meaningful
  regression.
- **P3 — Low:** A proven, limited defect or hardening gap has small impact and need
  not block merge. Do not use P3 for style, naming taste, or speculative cleanup.

Assess the worst credible impact for the established trigger, not an impossible
worst case. Do not inflate severity because the code touches a sensitive domain.

## Confidence

- **High:** Reproduced, test-proven, or established by a complete trace with no
  material unknown.
- **Medium:** Strong direct evidence supports the path, but a named environmental
  or integration detail could change the outcome.
- **Low:** A plausible concern still depends on an unverified premise.

Report verified findings at high or medium confidence. Put low-confidence concerns
under residual risk or questions, and use `INCONCLUSIVE` if they prevent a safe
decision in an elevated-risk area.

## Complete finding gate

Require every item:

1. **Attribution:** The reviewed scope introduced, exposed, or materially worsened
   the issue. Otherwise classify it as pre-existing.
2. **Contract:** A requirement, invariant, compatibility promise, or reasonable
   supported behaviour is violated.
3. **Reachability:** State the exact input, state, ordering, role, environment, or
   failure condition that triggers it.
4. **Mechanism:** Trace how the changed code produces the result, including guards
   and downstream handling.
5. **Impact:** Describe the observable user, data, security, financial, deployment,
   or operational consequence.
6. **Evidence:** Provide reproduction, test output, authoritative contract, static
   failure, or complete code reasoning.
7. **Location:** Cite the narrowest changed line that causes the issue in the final
   tree. Cite unchanged context only when essential.
8. **Actionability:** Give a minimal correction direction without designing an
   unrelated rewrite.
9. **Uniqueness:** Merge duplicate symptoms under their common root cause.
10. **Calibration:** Assign severity from impact and confidence from evidence.

Attempt to falsify the candidate before accepting it. Search for upstream
validation, downstream recovery, platform guarantees, configuration constraints,
and tests that contradict the hypothesis.

## Pre-existing and adjacent issues

Do not mix pre-existing issues into change-attributable findings. Mention one in a
separate section only when the user requested a broad audit, it creates immediate
severe risk, or it prevents validation of the reviewed work. Label the evidence
and attribution explicitly.

Do not report:

- style preferences without concrete impact;
- requests for extra defensive handling outside supported inputs;
- hypothetical future callers with no contract or plausible path;
- behaviour deliberately required by the request;
- failures solely caused by an unavailable local environment;
- a broad file-level concern without a precise causal location;
- multiple findings for the same root cause.

## Verdict matrix

Apply in this order:

1. Choose `REQUEST CHANGES` for any verified P0, P1, or P2 finding, or a
   change-attributable failure of a required check.
2. Otherwise choose `INCONCLUSIVE` when scope is unreliable or a material
   elevated-risk claim cannot be validated.
3. Otherwise choose `APPROVE`. P3 findings may remain explicitly non-blocking.

Approval is positive evidence that review depth and validation were proportionate;
it is not merely the absence of reported findings.
