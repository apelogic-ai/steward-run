import { createStewardFetch } from "../../src/transport.ts";

const [url, privateCaFile] = process.argv.slice(2);
if (!url || !privateCaFile) throw new Error("expected URL and private CA file");

const response = await (await createStewardFetch(privateCaFile))(url);
if (response.status !== 200) throw new Error(`unexpected status ${response.status}`);
process.stdout.write(await response.text());
