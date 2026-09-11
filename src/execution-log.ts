import { randomUUID } from "node:crypto";
import type { ExecutionTranscript } from "./archive.js";

export type LogChannel = "stdout" | "stderr";

export interface ExecutionLogDependencies {
  write?: (channel: LogChannel, value: string | Buffer) => void | Promise<void>;
  commandToken?: () => string;
}

const sensitiveOutputWarning =
  "::warning title=Sensitive Steward execution log::" +
  "Full Task stdout and stderr may contain prompts, repository data, model output, and tool results.\n";

function defaultWrite(channel: LogChannel, value: string | Buffer): void {
  (channel === "stdout" ? process.stdout : process.stderr).write(value);
}

function safeCommandToken(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new Error("execution log command token is invalid");
  }
  return value;
}

async function replayStream(
  label: "stdout" | "stderr",
  body: Buffer,
  write: NonNullable<ExecutionLogDependencies["write"]>,
  commandToken: NonNullable<ExecutionLogDependencies["commandToken"]>,
): Promise<void> {
  const channel: LogChannel = label;
  const token = safeCommandToken(commandToken());
  let failure: unknown;
  try {
    await write(channel, `::group::Steward Task ${label}\n`);
    await write(channel, `::stop-commands::${token}\n`);
    await write(channel, body);
    if (body.length === 0 || body.at(-1) !== 0x0a) await write(channel, "\n");
  } catch (error) {
    failure = error;
  }
  try {
    await write(channel, `::${token}::\n`);
  } catch (error) {
    failure ??= error;
  }
  try {
    await write(channel, "::endgroup::\n");
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
}

export async function replayExecutionTranscript(
  transcript: ExecutionTranscript,
  dependencies: ExecutionLogDependencies = {},
): Promise<void> {
  const write = dependencies.write ?? defaultWrite;
  const commandToken = dependencies.commandToken ?? (() => `steward-${randomUUID()}`);
  await write("stdout", sensitiveOutputWarning);
  await replayStream("stdout", transcript.stdout, write, commandToken);
  await replayStream("stderr", transcript.stderr, write, commandToken);
}
