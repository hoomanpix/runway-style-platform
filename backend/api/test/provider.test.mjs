import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRequestError, ReplicatePredictionClient } from "../src/replicate-provider.ts";

const signal = new AbortController().signal;

test("rejects an unapproved initial output URL before making a request", async () => {
  let calls = 0;
  const client = new ReplicatePredictionClient("secret-token", async () => {
    calls += 1;
    return new Response("unexpected");
  });
  await assert.rejects(client.downloadOutput("https://evil.example/output.png", signal), (error) => {
    assert(error instanceof ProviderRequestError);
    assert.equal(error.retryable, false);
    return /not permitted/.test(error.message);
  });
  assert.equal(calls, 0);
});

test("rejects redirects to an unapproved host and never forwards the bearer token", async () => {
  const calls = [];
  const client = new ReplicatePredictionClient("secret-token", async (url, init) => {
    calls.push({ url: url.toString(), headers: init.headers });
    return new Response(null, { status: 302, headers: { location: "https://evil.example/output.png" } });
  });
  await assert.rejects(client.downloadOutput("https://replicate.delivery/output.png", signal), /not permitted/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, undefined);
});

test("limits redirects even when every destination is approved", async () => {
  let calls = 0;
  const client = new ReplicatePredictionClient("secret-token", async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: `https://replicate.delivery/output-${calls + 1}.png` } });
  });
  await assert.rejects(client.downloadOutput("https://replicate.delivery/output-1.png", signal), /too many times/);
  assert.equal(calls, 4);
});

test("maps provider output errors without leaking response text", async () => {
  const client = new ReplicatePredictionClient("secret-token", async () => new Response("private provider detail", { status: 500 }));
  await assert.rejects(client.downloadOutput("https://replicate.delivery/output.png", signal), (error) => {
    assert(error instanceof ProviderRequestError);
    assert.equal(error.retryable, true);
    assert.equal(error.message, "The provider output could not be downloaded.");
    return true;
  });
});
