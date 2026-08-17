import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSERTION_STAGE_METADATA_VERSION,
  FAILURE_METADATA_VERSION,
  PROVIDER_CONNECTION_STAGE_METADATA_VERSION,
  PROVIDER_CONNECTION_STAGE_V2_METADATA_VERSION,
  PROVIDER_CONNECTION_STAGE_V3_METADATA_VERSION,
  StewardRunFailure,
  assertionStages,
  classifyAssertionStage,
  classifyFailureReason,
  classifyProviderConnectionStage,
  classifyProviderConnectionStageV2,
  classifyProviderConnectionStageV3,
  cleanupCategories,
  failureCategories,
  failurePhases,
  publishFailureMetadata,
  providerConnectionStages,
  providerConnectionStagesV2,
  providerConnectionStagesV3,
  type FailureMetadata,
} from "../src/failure-metadata.ts";

const terminalFailure: FailureMetadata = {
  version: FAILURE_METADATA_VERSION,
  phase: "failed",
  failureCategory: "runtime",
  cleanupCategory: "confirmed",
};

test("failure metadata uses a versioned bounded category allowlist", () => {
  assert.equal(FAILURE_METADATA_VERSION, "steward-run.failure/v1");
  assert.deepEqual(failurePhases, ["succeeded", "failed", "cancelled", "unavailable"]);
  assert.deepEqual(failureCategories, [
    "provider-connection",
    "provider-token-grant",
    "provider-grant",
    "provider-protocol",
    "provider-authorization",
    "provider-upstream",
    "assertion-mismatch",
    "workflow-cleanup",
    "authentication",
    "authorization",
    "configuration",
    "dependency",
    "input-output",
    "runtime",
    "timeout",
    "execution",
    "cancelled",
    "unknown",
  ]);
  assert.deepEqual(cleanupCategories, [
    "confirmed",
    "not-required",
    "request-failed",
    "confirmation-timeout",
    "identity-mismatch",
    "unknown",
  ]);
  assert.equal(classifyFailureReason("task agent exited with code 70"), "provider-connection");
  assert.equal(classifyFailureReason("task agent exited with code 71"), "provider-token-grant");
  assert.equal(classifyFailureReason("task agent exited with code 72"), "provider-authorization");
  assert.equal(classifyFailureReason("task agent exited with code 73"), "provider-upstream");
  assert.equal(classifyFailureReason("task agent exited with code 74"), "assertion-mismatch");
  assert.equal(classifyFailureReason("task agent exited with code 75"), "workflow-cleanup");
  assert.equal(classifyFailureReason("task agent exited with code 76"), "provider-grant");
  assert.equal(classifyFailureReason("task agent exited with code 77"), "provider-protocol");
  assert.equal(classifyFailureReason("task agent exited with code 82"), "provider-connection");
  assert.equal(classifyFailureReason("OpenShell sandbox runtime failed"), "runtime");
  assert.equal(classifyFailureReason("provider request deadline exceeded"), "timeout");
  assert.equal(classifyFailureReason("OIDC token rejected"), "authentication");
  assert.equal(classifyFailureReason("policy denied the requested tool"), "authorization");
  assert.equal(classifyFailureReason("MCP gateway unavailable"), "dependency");
  assert.equal(classifyFailureReason("model profile is invalid"), "configuration");
  assert.equal(classifyFailureReason("output archive was rejected"), "input-output");
  assert.equal(classifyFailureReason("command exited unsuccessfully"), "execution");
  assert.equal(classifyFailureReason("unrecognized server detail"), "unknown");
  assert.equal(classifyFailureReason(undefined), "unknown");
});

test("provider-connection exits map to an independently versioned bounded signal", async () => {
  assert.equal(PROVIDER_CONNECTION_STAGE_METADATA_VERSION, "steward-run.provider-connection-stage/v1");
  assert.deepEqual(providerConnectionStages, [
    "model-proxy-start",
    "model-request",
    "model-gateway",
    "agent-after-model",
  ]);
  const fixtures = [
    [82, "model-proxy-start"],
    [83, "model-request"],
    [84, "model-gateway"],
    [85, "agent-after-model"],
  ] as const;
  for (const [exitCode, stage] of fixtures) {
    const reason = `task agent exited with code ${exitCode}`;
    assert.equal(classifyFailureReason(reason), "provider-connection");
    assert.equal(classifyProviderConnectionStage(reason), stage);
    const annotations: string[] = [];
    await publishFailureMetadata(
      {
        version: FAILURE_METADATA_VERSION,
        phase: "failed",
        failureCategory: "provider-connection",
        cleanupCategory: "confirmed",
        providerConnectionStage: stage,
      },
      {
        writeAnnotation: async (value) => void annotations.push(value),
        writeStepSummary: async () => undefined,
      },
    );
    assert.deepEqual(annotations, [
      "steward-run.failure/v1 phase=failed failure-category=provider-connection cleanup-category=confirmed",
      `steward-run.provider-connection-stage/v1 stage=${stage}`,
    ]);
  }
  assert.equal(classifyProviderConnectionStage("task agent exited with code 70"), undefined);
  assert.equal(classifyProviderConnectionStage("task agent exited with code 82; token=private"), undefined);
});

test("provider-connection v2 distinguishes a local proxy rejection from LiteLLM HTTP", async () => {
  assert.equal(PROVIDER_CONNECTION_STAGE_V2_METADATA_VERSION, "steward-run.provider-connection-stage/v2");
  assert.deepEqual(providerConnectionStagesV2, [
    "model-proxy-start",
    "model-request",
    "model-proxy-contract",
    "litellm-http",
    "agent-after-model",
  ]);
  const fixtures = [
    [82, "model-proxy-start"],
    [83, "model-request"],
    [84, "model-proxy-contract"],
    [85, "litellm-http"],
    [86, "agent-after-model"],
  ] as const;
  for (const [exitCode, stage] of fixtures) {
    const annotations: string[] = [];
    const reason = `task agent exited with code ${exitCode}`;
    const providerConnectionStage = classifyProviderConnectionStage(reason);
    assert.equal(classifyProviderConnectionStageV2(reason), stage);
    await publishFailureMetadata(
      {
        version: FAILURE_METADATA_VERSION,
        phase: "failed",
        failureCategory: "provider-connection",
        cleanupCategory: "confirmed",
        providerConnectionStageV2: stage,
        ...(providerConnectionStage === undefined
          ? {}
          : { providerConnectionStage }),
      },
      {
        writeAnnotation: async (value) => void annotations.push(value),
        writeStepSummary: async () => undefined,
      },
    );
    assert.equal(annotations.at(-1), `steward-run.provider-connection-stage/v2 stage=${stage}`);
  }
  assert.equal(classifyProviderConnectionStageV2("task agent exited with code 84; body=private"), undefined);
});

test("provider-connection v3 distinguishes LiteLLM transport from HTTP", async () => {
  assert.equal(PROVIDER_CONNECTION_STAGE_V3_METADATA_VERSION, "steward-run.provider-connection-stage/v3");
  assert.deepEqual(providerConnectionStagesV3, [
    "model-proxy-start",
    "model-request",
    "model-proxy-contract",
    "litellm-transport",
    "litellm-http",
    "agent-after-model",
  ]);
  const fixtures = [
    [82, "model-proxy-start"],
    [83, "model-request"],
    [84, "model-proxy-contract"],
    [85, "litellm-http"],
    [86, "agent-after-model"],
    [87, "litellm-transport"],
  ] as const;
  for (const [exitCode, stage] of fixtures) {
    const annotations: string[] = [];
    const reason = `task agent exited with code ${exitCode}`;
    const providerConnectionStage = classifyProviderConnectionStage(reason);
    const providerConnectionStageV2 = classifyProviderConnectionStageV2(reason);
    assert.equal(classifyFailureReason(reason), "provider-connection");
    assert.equal(classifyProviderConnectionStageV3(reason), stage);
    await publishFailureMetadata(
      {
        version: FAILURE_METADATA_VERSION,
        phase: "failed",
        failureCategory: "provider-connection",
        cleanupCategory: "confirmed",
        ...(providerConnectionStage === undefined ? {} : { providerConnectionStage }),
        ...(providerConnectionStageV2 === undefined ? {} : { providerConnectionStageV2 }),
        providerConnectionStageV3: stage,
      },
      {
        writeAnnotation: async (value) => void annotations.push(value),
        writeStepSummary: async () => undefined,
      },
    );
    assert.equal(annotations.at(-1), `steward-run.provider-connection-stage/v3 stage=${stage}`);
  }
  assert.equal(classifyProviderConnectionStage("task agent exited with code 87"), "model-gateway");
  assert.equal(classifyProviderConnectionStageV2("task agent exited with code 87"), "litellm-http");
  assert.equal(classifyProviderConnectionStageV3("task agent exited with code 87; body=private"), undefined);

  const hostileVisible: string[] = [];
  await publishFailureMetadata(
    {
      version: FAILURE_METADATA_VERSION,
      phase: "failed",
      failureCategory: "provider-connection",
      cleanupCategory: "confirmed",
      providerConnectionStageV3: "litellm-transport token=private",
    } as unknown as FailureMetadata,
    {
      writeAnnotation: async (value) => void hostileVisible.push(value),
      writeStepSummary: async (value) => void hostileVisible.push(value),
    },
  );
  assert.doesNotMatch(hostileVisible.join("\n"), /provider-connection-stage\/v3|private/u);
});

test("assertion-stage exits map to an independently versioned bounded signal", async () => {
  assert.equal(ASSERTION_STAGE_METADATA_VERSION, "steward-run.assertion-stage/v1");
  assert.deepEqual(assertionStages, [
    "input-request",
    "runtime-toolchain",
    "model-result",
    "mcp-tool-event",
    "mcp-no-call",
  ]);

  const fixtures = [
    [78, "input-request"],
    [79, "runtime-toolchain"],
    [80, "model-result"],
    [81, "mcp-tool-event"],
    [88, "mcp-no-call"],
  ] as const;

  for (const [exitCode, stage] of fixtures) {
    const reason = `task agent exited with code ${exitCode}`;
    assert.equal(classifyFailureReason(reason), "assertion-mismatch");
    assert.equal(classifyAssertionStage(reason), stage);

    const annotations: string[] = [];
    const summaries: string[] = [];
    await publishFailureMetadata(
      {
        version: FAILURE_METADATA_VERSION,
        phase: "failed",
        failureCategory: classifyFailureReason(reason),
        cleanupCategory: "confirmed",
        assertionStage: stage,
      },
      {
        writeAnnotation: async (value) => void annotations.push(value),
        writeStepSummary: async (value) => void summaries.push(value),
      },
    );

    assert.deepEqual(annotations, [
      "steward-run.failure/v1 phase=failed failure-category=assertion-mismatch cleanup-category=confirmed",
      `steward-run.assertion-stage/v1 stage=${stage}`,
    ]);
    assert.equal(summaries.length, 1);
    assert.match(summaries[0] ?? "", new RegExp(`\\| steward-run\\.assertion-stage/v1 \\| ${stage} \\|`, "u"));
  }

  assert.equal(classifyFailureReason("task agent exited with code 74"), "assertion-mismatch");
  assert.equal(classifyAssertionStage("task agent exited with code 74"), undefined);
});

test("assertion-stage classification fails closed on hostile or malformed reasons", async () => {
  const hostileReasons = [
    "task agent exited with code 78; token=private-token",
    "task agent exited with code 79\nheader: Bearer private-bearer",
    "prefix task agent exited with code 80",
    "task agent exited with code 81 suffix",
    "task agent exited with code 81\n",
    "task agent exited with code 82",
  ];

  for (const reason of hostileReasons) {
    assert.equal(classifyAssertionStage(reason), undefined);
  }

  const visible: string[] = [];
  await publishFailureMetadata(
    {
      version: FAILURE_METADATA_VERSION,
      phase: "failed",
      failureCategory: "assertion-mismatch",
      cleanupCategory: "confirmed",
      assertionStage: "private-stage with token=private-token",
    } as unknown as FailureMetadata,
    {
      writeAnnotation: async (value) => void visible.push(value),
      writeStepSummary: async (value) => void visible.push(value),
    },
  );

  assert.deepEqual(visible.slice(0, 1), [
    "steward-run.failure/v1 phase=failed failure-category=assertion-mismatch cleanup-category=confirmed",
  ]);
  assert.equal(visible.length, 2);
  assert.doesNotMatch(visible.join("\n"), /private-stage|private-token|assertion-stage\/v1/u);
});

test("provider-protocol requires the exact unadorned exit-77 reason", async () => {
  const hostileReasons = [
    "task agent exited with code 77; token=private-token",
    "task agent exited with code 77\nheader: Bearer private-bearer",
    "task agent exited with code 77\nbody: private-response",
    "task agent exited with code 77\nsession: private-session",
    "prefix task agent exited with code 77",
    "task agent exited with code 77 suffix",
    "task agent exited with code 77\n",
    "\ttask agent exited with code 77",
    "task agent exited with code 770",
  ];

  for (const reason of hostileReasons) {
    assert.notEqual(classifyFailureReason(reason), "provider-protocol");
    const visible: string[] = [];
    await publishFailureMetadata(
      {
        version: FAILURE_METADATA_VERSION,
        phase: "failed",
        failureCategory: classifyFailureReason(reason),
        cleanupCategory: "confirmed",
      },
      {
        writeAnnotation: async (value) => void visible.push(value),
        writeStepSummary: async (value) => void visible.push(value),
      },
    );
    const rendered = visible.join("\n");
    assert.doesNotMatch(
      rendered,
      /private-token|private-bearer|private-response|private-session|Bearer|header:|body:|session:/u,
    );
  }
});

test("provider-protocol annotation and summary contain only the bounded contract", async () => {
  const visible: string[] = [];
  await publishFailureMetadata(
    {
      version: FAILURE_METADATA_VERSION,
      phase: "failed",
      failureCategory: classifyFailureReason("task agent exited with code 77"),
      cleanupCategory: "confirmed",
    },
    {
      writeAnnotation: async (value) => void visible.push(value),
      writeStepSummary: async (value) => void visible.push(value),
    },
  );

  assert.equal(
    visible[0],
    "steward-run.failure/v1 phase=failed failure-category=provider-protocol cleanup-category=confirmed",
  );
  assert.match(
    visible[1] ?? "",
    /\| steward-run\.failure\/v1 \| failed \| provider-protocol \| confirmed \|/u,
  );
});

test("provider-grant requires the exact anchored exit-76 reason", async () => {
  const hostileReasons = [
    "task agent exited with code 76; token=private-token",
    "task agent exited with code 76\nheader: Bearer private-bearer",
    "prefix task agent exited with code 76",
    "task agent exited with code 760",
  ];

  for (const reason of hostileReasons) {
    assert.notEqual(classifyFailureReason(reason), "provider-grant");
    const visible: string[] = [];
    await publishFailureMetadata(
      {
        version: FAILURE_METADATA_VERSION,
        phase: "failed",
        failureCategory: classifyFailureReason(reason),
        cleanupCategory: "confirmed",
      },
      {
        writeAnnotation: async (value) => void visible.push(value),
        writeStepSummary: async (value) => void visible.push(value),
      },
    );
    const rendered = visible.join("\n");
    assert.doesNotMatch(rendered, /private-token|private-bearer|Bearer|header:/u);
  }
});

test("provider-grant annotation and summary contain only the bounded contract", async () => {
  const visible: string[] = [];
  await publishFailureMetadata(
    {
      version: FAILURE_METADATA_VERSION,
      phase: "failed",
      failureCategory: classifyFailureReason("task agent exited with code 76"),
      cleanupCategory: "confirmed",
    },
    {
      writeAnnotation: async (value) => void visible.push(value),
      writeStepSummary: async (value) => void visible.push(value),
    },
  );

  assert.equal(
    visible[0],
    "steward-run.failure/v1 phase=failed failure-category=provider-grant cleanup-category=confirmed",
  );
  assert.match(
    visible[1] ?? "",
    /\| steward-run\.failure\/v1 \| failed \| provider-grant \| confirmed \|/u,
  );
});

test("GitHub annotation and step summary contain only the safe contract", async () => {
  const annotations: string[] = [];
  const summaries: string[] = [];
  await publishFailureMetadata(terminalFailure, {
    writeAnnotation: async (value) => void annotations.push(value),
    writeStepSummary: async (value) => void summaries.push(value),
  });

  assert.deepEqual(annotations, [
    "steward-run.failure/v1 phase=failed failure-category=runtime cleanup-category=confirmed",
  ]);
  assert.equal(summaries.length, 1);
  assert.match(summaries[0] ?? "", /steward-run\.failure\/v1/u);
  assert.match(summaries[0] ?? "", /\| failed \| runtime \| confirmed \|/u);
});

test("unknown hostile server data cannot escape the allowlist", async () => {
  const hostile = [
    "stdout=customer payload",
    "stderr=private stack trace",
    "header: Bearer jwt-secret",
    "set-cookie: session=private-session",
    "api_key=secret-value",
    "response body with assertion",
  ].join("\n");
  const metadata: FailureMetadata = {
    version: FAILURE_METADATA_VERSION,
    phase: "failed",
    failureCategory: classifyFailureReason(hostile),
    cleanupCategory: "unknown",
  };
  const visible: string[] = [];
  await publishFailureMetadata(metadata, {
    writeAnnotation: async (value) => void visible.push(value),
    writeStepSummary: async (value) => void visible.push(value),
  });
  const rendered = visible.join("\n");

  assert.match(rendered, /failure-category=unknown/u);
  for (const forbidden of [
    "customer payload",
    "private stack trace",
    "jwt-secret",
    "session=private-session",
    "secret-value",
    "assertion",
  ]) {
    assert.doesNotMatch(rendered, new RegExp(forbidden, "u"));
  }
});

test("primary and cleanup failures remain independently visible", () => {
  const failure = new StewardRunFailure({
    version: FAILURE_METADATA_VERSION,
    phase: "failed",
    failureCategory: "dependency",
    cleanupCategory: "request-failed",
  });

  assert.equal(
    failure.message,
    "Steward governed Task failed (phase=failed, failure-category=dependency, cleanup-category=request-failed)",
  );
  assert.deepEqual(failure.metadata, {
    version: FAILURE_METADATA_VERSION,
    phase: "failed",
    failureCategory: "dependency",
    cleanupCategory: "request-failed",
  });
});

test("runtime-invalid metadata values fail closed to fixed generic literals", async () => {
  const visible: string[] = [];
  await publishFailureMetadata(
    {
      version: "private-version",
      phase: "private-phase",
      failureCategory: "private-failure",
      cleanupCategory: "private-cleanup",
    } as unknown as FailureMetadata,
    {
      writeAnnotation: async (value) => void visible.push(value),
      writeStepSummary: async (value) => void visible.push(value),
    },
  );
  const rendered = visible.join("\n");
  assert.match(
    rendered,
    /steward-run\.failure\/v1 phase=unavailable failure-category=unknown cleanup-category=unknown/u,
  );
  assert.doesNotMatch(rendered, /private-version|private-phase|private-failure|private-cleanup/u);
});
