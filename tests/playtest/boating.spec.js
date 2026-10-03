// 10. Boating: a ticket at the shack by the Boating gateway, down the jetty stair with W, E at a
// moored swan (the lo-fi fading in), a loop out past the dam at 3 m/s and 4.5 with Shift, the
// long glide off the pedals (always BOAT.margin inside the water, the boat and the jogger in
// frame), no getting off mid-lake (and Esc only pauses), docking at a free berth (the music
// fading out), and back up the stair to the walk.  Then: the counter shuts in rain (open in fog), and a
// swan needs a ticket.
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

const BOAT_HINT = 'W/S pedal · A/D steer · Shift pedal hard · E dock · T time · K rain · P overview · M sound · L list · H hide · Esc pause';
const JOG_HINT = 'WASD jog · Shift run · E interact · V auto · T time · K rain · P overview · M sound · L list · H hide';

/** The feet follow the treads, by the stairs scenario's measure: never > 0.1 m into one, never > 0.2 m over, ≤ 0.06 m on average. */
function treads(tag, samples, c) {
  const sink = Math.max(0, ...samples.map((p) => -p.heightAboveGround)), float = Math.max(0, ...samples.map((p) => p.heightAboveGround));
  const mean = samples.reduce((a, p) => a + Math.abs(p.heightAboveGround), 0) / Math.max(1, samples.length);
  c.ok(sink <= 0.1 && float <= 0.2 && mean <= 0.06, `${tag}: sank ${sink.toFixed(3)} m, floated ${float.toFixed(3)} m, ${mean.toFixed(3)} m off on average`);
}

test('boating', async ({ page }) => {
  const api = T(page), rep = reporter('boating'), c = checks();
  await openGame(page, { query: 't=golden' });
  const step = (s) => api.advance(s, { dt: 1 / 60 });
  const P = (s, d) => page.evaluate(async ([s, d]) => { const { spineAt } = await import('/src/world/frame.js'); const f = spineAt(s); return [f.e + f.ne * d, f.n + f.nn * d]; }, [s, d]);
  const jetty = await api.jetty();

  /* ---- 1. the ticket ---- */
  {
    const shack = await page.evaluate(() => { const s = window.__scene.world.landmarks.club.shack; return { s: s.s, e: s.e, n: s.n }; });
    const [e, n] = await P(shack.s - 8, -1.2), [te, tn] = await P(shack.s + 1.5, 3.2);
    await api.frameShot(e, n, te, tn, -4, 4.2);
    await step(0.05);
    await rep.shot(page, 'ticket-shack');
  }
  await api.toSpot('counter');
  await step(0.2);
  let h = await api.getHud();
  c.ok((await api.nearestInteractable())?.kind === 'ticket', `the counter doesn't offer a ticket (${JSON.stringify(await api.nearestInteractable())})`);
  c.ok(h.prompt.visible && h.prompt.text === 'E Buy ticket', `counter prompt reads "${h.prompt.text}"`);
  c.ok(!h.ticket, 'a ticket in the HUD before buying one');
  await page.keyboard.press('KeyE');
  await step(0.6);
  h = await api.getHud();
  c.ok(h.ticket, 'E at the counter: no ticket in the HUD');
  c.ok(!/₹|\bRs\.?\s?\d|\d+\s?(rupees|INR)\b/i.test(await api.pageText()), 'a ticket price is shown somewhere');

  /* ---- 2. down the jetty stair, walking ---- */
  await api.toSpot('jettyStair');
  await page.keyboard.down('KeyW');
  const down = await api.advance(14, { dt: 1 / 60, every: 0.1 });
  await page.keyboard.up('KeyW');
  await step(1);
  treads('walking down the jetty stair', down, c);
  let jumps = 0;
  for (let i = 1; i < down.length; i++) if (Math.abs(down[i].y - down[i - 1].y) > 0.5) jumps++;
  c.ok(jumps === 0, `${jumps} height jumps over 0.5 m on the way down`);
  c.ok((await api.onJetty()).deck, `never reached the jetty's deck (${JSON.stringify(await api.onJetty())})`);

  /* ---- 3. a swan ---- */
  const at = await api.toSpot('berth');
  await step(0.2);
  const board = await api.nearestInteractable();
  c.ok(board?.kind === 'board', `beside a moored swan E offers ${JSON.stringify(board)}`);
  await page.keyboard.press('KeyE');
  await step(2.5);
  let p = await api.getPlayer(), b = await api.boat();
  h = await api.getHud();
  c.ok(p.state === 'boating' && b.phase === 'on' && b.visible, `didn't board (${p.state}, ${b.phase})`);
  c.ok(b.berth === at.berth, `boarded berth ${b.berth}, not the one beside you (${at.berth})`);
  c.ok(!h.ticket, 'the ticket is still in the HUD after boarding');
  c.ok(h.hint === BOAT_HINT, `boat hint bar reads "${h.hint}"`);
  c.ok(h.stats.some((s) => s.startsWith('boat distance')) && h.stats.some((s) => s.startsWith('ride time')), `the stats card isn't the boat's: ${JSON.stringify(h.stats)}`);
  c.ok(/Clear/.test(h.weather) && /golden/.test(h.preset), `the conditions card changed: ${h.preset} / ${h.weather}`);
  let f = await api.boatInFrame();
  c.ok(f.inFrame, `boarding: the boat or the jogger is out of frame ${JSON.stringify(f)}`);
  const lows = await api.bodyLows();
  c.ok(lows.pelvis.y > 1.03, `seated in the swan the hips are at ${lows.pelvis.y} (seat top 1.05 + bob)`);
  await rep.shot(page, 'boarding');
  // the lo-fi fades in as you board (the audio clock is real time: wait ~3 s), ducking the
  // ambience but not the boat's own water or the rain
  await page.waitForTimeout(3300);
  let m = await api.music();
  h = await api.getHud();
  c.ok(m.gain > 0.35 && h.sound === 'Music', `boarding: the music didn't fade in (gain ${m.gain}, card "${h.sound}")`);
  c.ok(m.buses.amb < 0.7 && m.buses.boat > 0.95 && m.buses.rain > 0.95, `boarding: the ducking is wrong ${JSON.stringify(m.buses)}`);
  // V does nothing in a boat
  await page.keyboard.press('KeyV');
  await step(0.2);
  p = await api.getPlayer();
  c.ok(!p.auto && p.state === 'boating', `V in the boat: auto ${p.auto}, ${p.state}`);

  /* ---- 4. a loop out past the dam ---- */
  // pedal straight out of the berth: up to speed in about a second, 3 m/s
  await page.keyboard.down('KeyW');
  await step(1);
  const after1 = (await api.boat()).speed;
  await step(3);
  await page.keyboard.up('KeyW');
  const cruise = (await api.boat()).speed;
  c.ok(after1 >= 1.9, `after 1 s of pedalling: ${after1} m/s (want ~2/3 of 3.0)`);
  c.ok(Math.abs(cruise - 3.0) < 0.1, `pedalling speed ${cruise} m/s (want 3.0)`);
  const legs = [];
  // the second leg with Shift: 4.5 m/s, on stamina
  for (const [s, d, fast] of [[jetty.s, jetty.d1 + 25, false], [2150, 60, true], [1850, 55, false], [1700, 55, false]]) {
    const [e, n] = await P(s, d);
    legs.push({ s, d, fast, ...(await api.driveTo(e, n, { tol: 8, fast })) });
  }
  const hard = legs.find((l) => l.fast);
  c.ok(hard.maxSpeed > 4.3 && hard.maxSpeed <= 4.55, `pedalling hard reached ${hard.maxSpeed} m/s (want 4.5)`);
  c.ok(hard.minStamina < 90, `pedalling hard didn't drain stamina (lowest ${hard.minStamina})`);
  // (the leg after the hard one starts at 4.5 and eases back: judge the one before it)
  c.ok(legs[0].maxSpeed <= 3.05, `${legs[0].maxSpeed} m/s without Shift (want 3.0)`);
  for (const l of legs) {
    c.ok(l.arrived, `leg to s ${l.s} d ${l.d}: didn't arrive (${l.left} m short after ${l.t} s)`);
    c.ok(l.belowMargin === 0, `leg to s ${l.s}: ${l.belowMargin} samples closer than the margin to the shore (worst ${l.worstShore} m)`);
    c.ok(l.framed === l.frames, `leg to s ${l.s}: the boat or the jogger out of frame in ${l.frames - l.framed} of ${l.frames} checks`);
  }
  b = await api.boat();
  c.ok(b.distance > 500, `boat distance ${b.distance} m after the loop`);
  h = await api.getHud();
  const km = parseFloat(h.stats.find((s) => s.startsWith('boat distance')).split(': ')[1]);
  c.ok(Math.abs(km * 1000 - b.distance) < 15, `the card reads ${km} km, the boat went ${b.distance} m`);
  // mid-lake at golden hour, turned to look back at the dam
  {
    const [e, n] = await P(1700, 10);
    await api.driveTo(e, n, { tol: 40, maxT: 30 });
    const v0 = (await api.boat()).speed;
    await step(3); // the long glide off the pedals, the camera settling in behind
    const v3 = (await api.boat()).speed;
    c.ok(v0 > 2.5 && v3 > 0.4 * v0, `the glide: ${v0} m/s off the pedals, ${v3} m/s 3 s later (want a long glide)`);
    await step(1);
    await api.setTime('golden'); // (the ride took the clock on past it)
    f = await api.boatInFrame();
    c.ok(f.inFrame, `mid-lake: the boat or the jogger is out of frame ${JSON.stringify(f)}`);
    await rep.shot(page, 'mid-lake-dam');
  }
  // E mid-lake doesn't let you off; Esc only pauses
  await page.keyboard.press('KeyE');
  await step(0.3);
  h = await api.getHud();
  p = await api.getPlayer();
  c.ok(p.state === 'boating', `E mid-lake: state ${p.state}`);
  c.ok(h.toast.visible && h.toast.text === 'Dock at the jetty to get off', `E mid-lake: toast "${h.toast.text}"`);
  await page.keyboard.press('Escape');
  await step(0.2);
  h = await api.getHud();
  c.ok(h.paused && (await api.getPlayer()).state === 'boating', `Esc in the boat: paused ${h.paused}, ${(await api.getPlayer()).state}`);
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await step(0.2);
  c.ok(!(await api.getHud()).paused && (await api.getPlayer()).state === 'boating', 'Esc again: not resumed, or out of the boat');

  /* ---- 5. back to the jetty, and dock ---- */
  for (const [s, d] of [[2150, 60], [jetty.s, jetty.d1 + 20]]) { const [e, n] = await P(s, d); const l = await api.driveTo(e, n, { tol: 7 }); c.ok(l.arrived && l.belowMargin === 0, `the way back to s ${s}: ${JSON.stringify(l)}`); }
  const free = (await api.berths()).filter((x) => !x.moored).sort((x, y) => y.d - x.d)[0];
  const yaw = await page.evaluate((i) => window.__scene.world.landmarks.club.berths[i].yaw, free.i);
  const fe = -Math.sin(yaw), fn = Math.cos(yaw);
  await api.driveTo(free.e + fe * 9, free.n + fn * 9, { tol: 3 });
  await api.driveTo(free.e + fe * 4, free.n + fn * 4, { tol: 2, maxT: 60 });
  const dock = await api.nearestInteractable();
  c.ok(dock?.kind === 'dock', `near free berth ${free.i}: E offers ${JSON.stringify(dock)}`);
  h = await api.getHud();
  c.ok(h.prompt.text === 'E Dock', `dock prompt reads "${h.prompt.text}"`);
  await page.keyboard.press('KeyE');
  await step(0.8);
  await rep.shot(page, 'docking');
  await step(1.2);
  p = await api.getPlayer(); b = await api.boat();
  await page.waitForTimeout(2600); // the music fades out as you dock (real time)
  m = await api.music();
  c.ok(m.gain < 0.05 && (await api.getHud()).sound === 'Sound on', `docked: the music is still playing (gain ${m.gain}, card "${(await api.getHud()).sound}")`);
  const berths = await api.berths();
  c.ok(p.state !== 'boating' && b.phase === 'off' && !b.visible, `after docking: ${p.state}, boat ${b.phase}`);
  c.ok(berths.find((x) => x.i === free.i)?.moored, `berth ${free.i} is still empty after docking`);
  c.ok((await api.onJetty()).deck && !p.onWater && Math.abs(p.heightAboveGround) < 0.05, `ashore: ${JSON.stringify(await api.onJetty())}, onWater ${p.onWater}, ${p.heightAboveGround} m`);
  h = await api.getHud();
  c.ok(h.hint === JOG_HINT && h.stats.some((s) => s.startsWith('pace')), `back ashore the HUD is still the boat's: ${h.hint} / ${h.stats}`);
  await rep.shot(page, 'docked');

  /* ---- 6. up the stair to the walk ---- */
  {
    const j = await api.onJetty();
    // to the middle of the jetty, then up the stair
    const [e, n] = [jetty.e + jetty.ne * j.u, jetty.n + jetty.nn * j.u];
    await api.lookAt(e, n);
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 60 && Math.abs((await api.onJetty()).v) > 0.4; i++) await api.advance(0.05, { dt: 1 / 60 });
    await page.keyboard.up('KeyW');
    await api.face('city');
    await page.keyboard.down('KeyW');
    const up = [];
    for (let i = 0; i < 80; i++) { up.push(...(await api.advance(0.5, { dt: 1 / 60, every: 0.1 }))); if (up.at(-1).d < 3.2) break; }
    await page.keyboard.up('KeyW');
    let jmp = 0;
    for (let i = 1; i < up.length; i++) if (Math.abs(up[i].y - up[i - 1].y) > 0.5) jmp++;
    p = await api.getPlayer();
    c.ok(p.d < 4, `didn't climb back to the walk (at d ${p.d}, y ${p.y})`);
    treads('climbing the jetty stair', up, c);
    c.ok(jmp === 0, `climbing the jetty stair: ${jmp} height jumps over 0.5 m`);
  }

  /* ---- 7. the counter in rain and fog; a swan without a ticket ---- */
  await api.setWeather('rain');
  await api.toSpot('counter');
  await step(0.2);
  h = await api.getHud();
  c.ok(h.prompt.visible && h.prompt.text === 'Closed · rain', `in rain the counter reads "${h.prompt.text}"`);
  await page.keyboard.press('KeyE');
  await step(0.3);
  c.ok(!(await api.getHud()).ticket, 'bought a ticket in the rain');
  await rep.shot(page, 'closed-rain');
  await api.setWeather('fog');
  await step(0.2);
  c.ok((await api.nearestInteractable())?.kind === 'ticket', 'the counter is shut in fog');
  await api.setWeather('clear');
  await api.toSpot('berth');
  await step(0.2);
  const noTicket = await api.nearestInteractable();
  c.ok(noTicket?.kind === 'say' && /ticket/i.test(noTicket.text), `a swan without a ticket offers ${JSON.stringify(noTicket)}`);
  await page.keyboard.press('KeyE');
  await step(0.3);
  c.ok((await api.getPlayer()).state !== 'boating', 'boarded without a ticket');

  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails, legs, boat: b });
  c.done(expect);
});
