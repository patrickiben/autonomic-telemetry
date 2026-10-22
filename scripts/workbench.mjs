import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Real browser flows with invented task text and mocked raw sensor events.
// This does not verify a physical wearable or any physiological interpretation.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const filename = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!filename.startsWith(root + path.sep)) return response.writeHead(403).end();
    const body = await readFile(filename);
    response.writeHead(200, { "Content-Type": filename.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" });
    response.end(body);
  } catch { response.writeHead(404).end("Not found"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }).catch(async error => {
  await new Promise(resolve => server.close(resolve));
  throw error;
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
context.setDefaultTimeout(10_000);
const externalRequests = [], pageErrors = [];
await context.route("**/*", route => {
  const url = route.request().url();
  if (url.startsWith(base + "/") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
  externalRequests.push(url);
  return route.abort();
});
context.on("page", page => page.on("pageerror", error => pageErrors.push(error.message)));
let checks = 0;
async function check(name, run) { await run(); checks += 1; console.log(`✓ ${name}`); }

try {
  const page = await context.newPage();
  await page.goto(`${base}/Autonomic_Telemetry_Console.html`);
  await page.waitForFunction(() => Boolean(window.TelemetryWork));

  await check("Work opens as an untimed task companion with no sensor or running timer required", async () => {
    await page.evaluate(() => window.Telemetry.setMode("work"));
    assert.equal(await page.locator("#work-timer-panel").isVisible(), false);
    assert.equal(await page.locator("#task-input").isVisible(), true);
    assert.equal(await page.locator("#parking-input").count(), 1);
    const state = await page.evaluate(() => ({ work: window.TelemetryWork.getState(), practice: window.Telemetry.getModeState().practice }));
    assert.equal(state.work.remember, false);
    assert.equal(state.work.tasks.length, 0);
    assert.equal(state.practice.phase, "idle");
  });

  await check("one current task is explicit, later tasks queue, and state snapshots are immutable copies", async () => {
    const result = await page.evaluate(() => {
      const W = window.TelemetryWork;
      const first = W.addTask("Draft one paragraph");
      const second = W.addTask("Read one section");
      const queued = W.getState();
      W.setCurrent(second);
      const switched = W.getState();
      const copy = W.getState();
      copy.tasks[0].title = "Mutated external snapshot";
      copy.tasks.length = 0;
      return { first, second, queued, switched, after: W.getState() };
    });
    assert.equal(result.queued.currentTaskId, result.first);
    assert.equal(result.queued.tasks.find(task => task.id === result.first).state, "active");
    assert.equal(result.queued.tasks.find(task => task.id === result.second).state, "queued");
    assert.equal(result.switched.currentTaskId, result.second);
    assert.equal(result.switched.tasks.filter(task => task.state === "active").length, 1);
    assert.equal(result.after.tasks.length, 2);
    assert.equal(result.after.tasks[0].title, "Draft one paragraph");
  });

  await check("steps and restart notes belong to their task, and invalid task/step edits fail", async () => {
    const result = await page.evaluate(() => {
      const W = window.TelemetryWork, id = W.getState().currentTaskId;
      W.addStep(id, "Read the first paragraph");
      const stepId = W.getState().tasks.find(task => task.id === id).steps[0].id;
      W.toggleStep(id, stepId, true);
      W.setRestartNote(id, "Continue with the second paragraph");
      const rejects = run => { try { run(); return false; } catch { return true; } };
      const invalid = [
        () => W.addTask("   "),
        () => W.addStep(id, ""),
        () => W.addStep("missing-task", "A step"),
        () => W.toggleStep(id, "missing-step", true),
        () => W.setCurrent("missing-task"),
      ].map(rejects);
      return { invalid, task: W.getState().tasks.find(task => task.id === id) };
    });
    assert.ok(result.invalid.every(Boolean));
    assert.equal(result.task.steps[0].done, true);
    assert.equal(result.task.restartNote, "Continue with the second paragraph");
  });

  await check("finishing leaves the next choice open, while break/resume and reopening preserve task context", async () => {
    const result = await page.evaluate(() => {
      const W = window.TelemetryWork, current = W.getState().currentTaskId;
      W.setBreak(true);
      const takingBreak = W.getState();
      W.setBreak(false);
      const resumed = W.getState();
      W.completeTask(current);
      const completed = W.getState();
      W.reopenTask(current);
      const reopened = W.getState();
      W.setCurrent(current);
      return { current, takingBreak, resumed, completed, reopened, final: W.getState(), phase: window.Telemetry.getModeState().practice.phase };
    });
    assert.equal(result.takingBreak.onBreak, true);
    assert.equal(result.takingBreak.currentTaskId, result.current);
    assert.equal(result.resumed.onBreak, false);
    assert.equal(result.resumed.currentTaskId, result.current);
    assert.equal(result.completed.currentTaskId, null);
    assert.equal(result.completed.tasks.filter(task => task.state === "active").length, 0);
    const finished = result.completed.tasks.find(task => task.id === result.current);
    assert.equal(finished.state, "done");
    assert.ok(Number.isFinite(finished.completedAt));
    assert.equal(result.reopened.tasks.find(task => task.id === result.current).state, "active");
    assert.equal(result.final.tasks.find(task => task.id === result.current).restartNote, "Continue with the second paragraph");
    assert.equal(result.phase, "idle");
  });

  await check("the parking lot can remove or promote thoughts without replacing the current task", async () => {
    const result = await page.evaluate(() => {
      const W = window.TelemetryWork, current = W.getState().currentTaskId;
      W.park("Check one reference later");
      const promoted = W.getState().parking.at(-1).id;
      W.park("An expendable thought");
      const removed = W.getState().parking.at(-1).id;
      W.removeParked(removed);
      W.promoteParked(promoted);
      return { current, state: W.getState() };
    });
    assert.equal(result.state.parking.length, 0);
    assert.equal(result.state.currentTaskId, result.current);
    assert.equal(result.state.tasks.find(task => task.title === "Check one reference later").state, "queued");
  });

  await check("promoting a long parked thought preserves its complete text across title and restart note", async () => {
    const thought = "0123456789".repeat(28) + " next detail";
    const result = await page.evaluate(thought => {
      const W = window.TelemetryWork, parked = W.park(thought);
      const taskId = W.promoteParked(parked);
      const state = W.getState();
      return { task: state.tasks.find(task => task.id === taskId), stillParked: state.parking.some(item => item.id === parked) };
    }, thought);
    assert.equal(result.task.title + result.task.restartNote, thought);
    assert.ok(result.task.title.length <= 160 && result.task.restartNote.length <= 160);
    assert.equal(result.stillParked, false);
  });

  await check("completed task guards reject edits atomically until the task is explicitly reopened", async () => {
    const result = await page.evaluate(() => {
      const W = window.TelemetryWork, id = W.addTask("Completed task guard fixture"), step = W.addStep(id, "A completed-task step");
      W.completeTask(id);
      const before = JSON.stringify(W.getState());
      const rejected = [() => W.setCurrent(id), () => W.addStep(id, "Unexpected step"), () => W.toggleStep(id, step, true), () => W.removeStep(id, step)].map(run => { try { run(); return false; } catch { return true; } });
      const unchanged = before === JSON.stringify(W.getState());
      W.reopenTask(id);
      let repeatedReopenRejected = false;
      try { W.reopenTask(id); } catch { repeatedReopenRejected = true; }
      return { rejected, unchanged, repeatedReopenRejected };
    });
    assert.ok(result.rejected.every(Boolean));
    assert.equal(result.unchanged, true);
    assert.equal(result.repeatedReopenRejected, true);
  });

  await check("task notes export and reimport without changing sensor data or granting storage consent", async () => {
    const result = await page.evaluate(() => {
      const T = window.Telemetry, W = window.TelemetryWork;
      const before = W.getState();
      const exported = T.getExport();
      T.openSession(T.parseSession(JSON.stringify(exported), "json", "Saved task notes"));
      const after = W.getState();
      const malformed = structuredClone(exported);
      malformed.workspace.workbench.tasks[0].state = "invented-state";
      let rejected = false;
      try { T.parseSession(JSON.stringify(malformed), "json", "Invalid task state"); } catch { rejected = true; }
      const legacy = structuredClone(exported);
      delete legacy.workspace.workbench;
      let legacyAccepted = true;
      try { T.parseSession(JSON.stringify(legacy), "json", "Older workspace"); } catch { legacyAccepted = false; }
      return { before, after, exported, second: T.getExport(), rejected, legacyAccepted, stored: localStorage.getItem("autonomic_workbench_v1") };
    });
    assert.deepEqual(result.after.tasks, result.before.tasks);
    assert.equal(result.after.currentTaskId, result.before.currentTaskId);
    assert.deepEqual(result.second.samples, result.exported.samples);
    assert.equal(result.after.remember, false);
    assert.equal(result.stored, null);
    assert.equal(result.rejected, true);
    assert.equal(result.legacyAccepted, true);
  });

  await check("task, step, parking, completion, and break controls work without starting a timer", async () => {
    await page.evaluate(() => window.Telemetry.setMode("work"));
    const payload = '<img data-task-probe="x" src="https://invalid.example/task" onerror="window.taskInjected=1">';
    await page.locator("#task-input").fill(payload);
    await page.locator("#task-add").click();
    const id = await page.evaluate(payload => {
      const W = window.TelemetryWork;
      const id = W.getState().tasks.find(task => task.title === payload).id;
      W.setCurrent(id);
      return id;
    }, payload);
    assert.equal(await page.locator("#task-title").innerText(), payload);
    assert.equal(await page.locator("img[data-task-probe]").count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.taskInjected)), false);
    await page.locator("#step-input").fill("Name the next small action");
    await page.locator("#step-add").click();
    assert.equal(await page.evaluate(id => window.TelemetryWork.getState().tasks.find(task => task.id === id).steps[0].text, id), "Name the next small action");
    const priorChecks = await page.evaluate(() => window.TelemetryWork.getState().tasks.reduce((count, task) => count + task.steps.filter(step => step.done).length, 0));
    await page.locator("#task-steps input[data-step]").first().check();
    assert.equal(await page.evaluate(id => window.TelemetryWork.getState().tasks.find(task => task.id === id).steps[0].done, id), true);
    assert.match(await page.locator("#progress-trail").getAttribute("aria-label"), new RegExp(`^${priorChecks + 1} steps`));
    await page.locator("#work-break").click();
    assert.equal(await page.evaluate(() => window.TelemetryWork.getState().onBreak), true);
    await page.locator("#work-break").click();
    assert.equal(await page.evaluate(() => window.TelemetryWork.getState().onBreak), false);
    await page.locator("#parking-summary").click();
    await page.locator("#parking-input").fill("A thought for later");
    await page.locator("#parking-add").click();
    assert.ok(await page.evaluate(() => window.TelemetryWork.getState().parking.some(item => item.text === "A thought for later")));
    await page.locator("#task-complete").click();
    assert.equal(await page.evaluate(() => window.TelemetryWork.getState().currentTaskId), null);
    assert.equal(await page.evaluate(() => window.Telemetry.getModeState().practice.phase), "idle");
  });

  await check("remembering tasks requires opt-in, restores after reload, and excludes all health records", async () => {
    await page.evaluate(() => window.Telemetry.loadHealth('<HealthData><Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Synthetic health context" unit="count/min" value="88" startDate="2026-10-21 08:00:00 -0400"/></HealthData>'));
    const before = await page.evaluate(() => window.TelemetryWork.getState());
    assert.equal(await page.evaluate(() => localStorage.getItem("autonomic_workbench_v1")), null);
    await page.locator("#remember-work").check();
    const saved = await page.evaluate(() => ({ keys: Object.keys(localStorage), value: localStorage.getItem("autonomic_workbench_v1") }));
    assert.deepEqual(saved.keys, ["autonomic_workbench_v1"]);
    assert.ok(saved.value.includes("Draft one paragraph"));
    for (const key of ["samples", "context", "records", "baseline", "heart_rate_bpm", "rmssd_ms", "workspace"]) {
      assert.ok(!saved.value.includes(`"${key}"`), `Task storage unexpectedly included ${key}`);
    }
    await page.reload();
    await page.waitForFunction(() => Boolean(window.TelemetryWork));
    const restored = await page.evaluate(() => window.TelemetryWork.getState());
    assert.deepEqual(restored.tasks, before.tasks);
    assert.deepEqual(restored.parking, before.parking);
    assert.equal(restored.remember, true);
    assert.equal(await page.evaluate(() => window.Telemetry.getState().context), null);
    await page.evaluate(() => window.Telemetry.setMode("work"));
    await page.locator("#remember-work").uncheck();
    assert.equal(await page.evaluate(() => localStorage.getItem("autonomic_workbench_v1")), null);
    assert.equal((await page.evaluate(() => window.TelemetryWork.getState())).tasks.length, before.tasks.length);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.TelemetryWork));
    assert.equal((await page.evaluate(() => window.TelemetryWork.getState())).tasks.length, 0);
  });

  await check("blocked browser storage leaves the untimed workspace usable and reports the limitation", async () => {
    const blocked = await context.newPage();
    await blocked.addInitScript(() => Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("Storage disabled for this test", "SecurityError"); } }));
    await blocked.goto(`${base}/Autonomic_Telemetry_Console.html`);
    await blocked.waitForFunction(() => Boolean(window.TelemetryWork));
    await blocked.evaluate(() => {
      window.Telemetry.setMode("work");
      window.TelemetryWork.addTask("Keep this task in memory");
      window.TelemetryWork.setRemember(true);
    });
    assert.equal((await blocked.evaluate(() => window.TelemetryWork.getState())).tasks[0].title, "Keep this task in memory");
    assert.match(await blocked.locator("#work-status").innerText(), /storage|remember|browser|unavailable|save/i);
    await blocked.close();
  });

  await check("a restart-note saving failure preserves the note and visibly turns off remembering", async () => {
    const failure = await context.newPage();
    await failure.goto(`${base}/Autonomic_Telemetry_Console.html`);
    await failure.waitForFunction(() => Boolean(window.TelemetryWork));
    const result = await failure.evaluate(() => {
      const W = window.TelemetryWork;
      window.Telemetry.setMode("work");
      const id = W.addTask("Synthetic persistence failure fixture");
      W.setRemember(true);
      Storage.prototype.setItem = () => { throw new DOMException("Mock quota failure", "QuotaExceededError"); };
      W.setRestartNote(id, "Resume at the next sentence");
      return W.getState();
    });
    assert.equal(result.remember, false);
    assert.equal(result.tasks[0].restartNote, "Resume at the next sentence");
    assert.equal(await failure.locator("#remember-work").isChecked(), false);
    assert.match(await failure.locator("#work-status").innerText(), /could not update saved tasks|storage|unavailable/i);
    await failure.evaluate(() => window.TelemetryWork.setRemember(false));
    await failure.close();
  });

  await check("the untimed task board fits a phone and its optional timer opens without starting", async () => {
    await page.evaluate(() => window.Telemetry.setMode("work"));
    await page.setViewportSize({ width: 360, height: 800 });
    await page.locator("#task-input").fill("A long but concrete task title to keep the next action visible on a small phone screen");
    await page.locator("#task-add").click();
    await page.locator("#step-input").fill("One small action");
    await page.locator("#step-add").click();
    await page.locator("#parking-summary").click();
    await page.locator("#parking-input").fill("A thought that can wait while I stay with the current task");
    await page.locator("#parking-add").click();
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth, heights: ["task-add", "step-add", "task-complete", "work-break", "parking-add", "work-timer-toggle"].map(id => ({ id, height: document.getElementById(id).getBoundingClientRect().height })) }));
    assert.ok(dimensions.content <= dimensions.viewport + 1, `${dimensions.content}px content in 360px viewport`);
    assert.ok(dimensions.heights.every(control => control.height >= 44), JSON.stringify(dimensions.heights));
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const quick = page.locator("#mobile-work-action"), box = await quick.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 800, "Untimed quick control should stay reachable after scrolling");
    await page.locator(".mobile-work-return").click();
    await page.waitForFunction(() => {
      const title = document.querySelector("#task-title").getBoundingClientRect();
      return title.top >= -1 && title.bottom <= innerHeight;
    });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    assert.equal(await quick.innerText(), "Step done");
    await quick.click();
    assert.equal(await quick.innerText(), "Task done");
    await quick.click();
    assert.equal(await page.evaluate(() => window.TelemetryWork.getState().currentTaskId), null);
    assert.equal(await page.evaluate(() => window.Telemetry.getModeState().practice.phase), "idle");
    assert.equal(await page.locator("#work-timer-panel").isVisible(), false);
    await page.locator("#work-timer-toggle").click();
    assert.equal(await page.locator("#work-timer-panel").isVisible(), true);
    assert.equal(await page.evaluate(() => window.Telemetry.getModeState().practice.phase), "idle");
    await page.locator("#work-timer-toggle").click();
    assert.equal(await page.locator("#work-timer-panel").isVisible(), false);
  });

  await check("bio visuals distinguish explicit demo/ambient from fresh, stale, and disconnected raw sensor events", async () => {
    const bio = await context.newPage();
    await bio.clock.install({ time: new Date("2026-10-22T12:00:00Z") });
    await bio.goto(`${base}/Autonomic_Telemetry_Console.html`);
    await bio.waitForFunction(() => Boolean(window.TelemetryBio));
    await bio.clock.pauseAt(new Date("2026-10-22T12:00:01Z"));
    const initial = await bio.evaluate(() => {
      window.Telemetry.restart();
      return window.TelemetryBio.getState();
    });
    assert.equal(initial.source, "muse");
    assert.equal(initial.visual, "bloom");
    assert.equal(initial.phase, "waiting");
    assert.equal(initial.reducedMotion, true);
    const before = await bio.evaluate(() => JSON.stringify(window.Telemetry.getState().dataset));
    await bio.evaluate(() => {
      window.__bioDevice = { connected: true, phase: "streaming" };
      window.TelemetryDevices.getState = () => ({ ...window.__bioDevice });
      window.TelemetryBio.setVisual("bloom");
      window.dispatchEvent(new CustomEvent("telemetry:raw", { detail: { type: "eeg", channel: 0, index: 1, samples: [0, 1, 0, -1], receivedAt: Date.now() } }));
    });
    await bio.clock.fastForward(1000);
    const fresh = await bio.evaluate(() => window.TelemetryBio.getState());
    assert.equal(fresh.phase, "live");
    assert.equal(fresh.source, "muse");
    assert.ok(fresh.sampleCounts.eeg > 0);
    assert.match(await bio.locator("#bio-badge").innerText(), /LIVE.*RAW/i);
    const channels = await bio.evaluate(() => {
      const B = window.TelemetryBio;
      B.setVisual("ribbon");
      const withoutPpg = B.getState().phase;
      window.dispatchEvent(new CustomEvent("telemetry:raw", { detail: { type: "ppg", channel: 1, samples: [100, 102, 101, 99], receivedAt: Date.now() } }));
      const withPpg = B.getState().phase;
      B.setVisual("motion");
      const withoutAcc = B.getState().phase;
      window.dispatchEvent(new CustomEvent("telemetry:raw", { detail: { type: "acc", channel: 0, samples: [{ x: 0, y: 0, z: 1 }, { x: 0.1, y: 0, z: 1 }], receivedAt: Date.now() } }));
      const withAcc = B.getState().phase;
      B.setVisual("tide");
      return { withoutPpg, withPpg, withoutAcc, withAcc };
    });
    assert.equal(channels.withoutPpg, "waiting");
    assert.equal(channels.withPpg, "live");
    assert.equal(channels.withoutAcc, "waiting");
    assert.equal(channels.withAcc, "live");
    await bio.locator("#bio-quiet").dispatchEvent("click");
    assert.equal(await bio.evaluate(() => window.TelemetryBio.getState().quiet), true);
    assert.equal(await bio.locator("#bio-stage").isVisible(), false);
    await bio.locator("#bio-quiet").dispatchEvent("click");
    assert.equal(await bio.evaluate(() => window.TelemetryBio.getState().quiet), false);
    await bio.clock.fastForward(6000);
    const stale = await bio.evaluate(() => window.TelemetryBio.getState());
    assert.equal(stale.phase, "stale");
    assert.equal(stale.source, "muse");
    await bio.evaluate(() => window.__bioDevice = { connected: false, phase: "disconnected" });
    await bio.clock.fastForward(1000);
    assert.notEqual(await bio.evaluate(() => window.TelemetryBio.getState().phase), "live");
    await bio.evaluate(() => window.TelemetryBio.setSource("demo"));
    assert.equal(await bio.evaluate(() => window.TelemetryBio.getState().phase), "demo");
    assert.match(await bio.locator("#bio-badge").innerText(), /demo|synthetic/i);
    for (const visual of ["bloom", "tide", "ribbon", "motion"]) {
      await bio.evaluate(visual => window.TelemetryBio.setVisual(visual), visual);
      assert.equal(await bio.evaluate(() => window.TelemetryBio.getState().visual), visual);
    }
    await bio.evaluate(() => window.TelemetryBio.setSource("ambient"));
    assert.equal(await bio.evaluate(() => window.TelemetryBio.getState().phase), "ambient");
    assert.equal(await bio.evaluate(() => JSON.stringify(window.Telemetry.getState().dataset)), before);
    await bio.close();
  });

  assert.deepEqual(pageErrors, [], "Unexpected browser exceptions");
  assert.deepEqual(externalRequests, [], "An untimed workspace attempted an external request");
  console.log(`\n${checks} workbench checks passed; no page errors or external requests.`);
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
