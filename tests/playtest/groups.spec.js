// 11. Joining a group: the laughter club and a chatting circle.  E within ~4 m: the circle opens
// a gap, the jogger steps in and faces the middle, and joins in -- for as long as you stay (30 s
// here, the club still laughing and chanting).  The first Esc leaves (the circle closes up), a
// second Esc pauses; joining again, W leaves.
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

const GROUP_HINT = 'Esc · leave the group · WASD leave · T time · K rain · M sound · H hide';
const JOG_HINT = 'WASD jog · Shift run · E interact · V auto · T time · K rain · P overview · M sound · L list · H hide';

/** Where the player stands in the circle: on the ring, facing the middle, room either side. */
async function placeIn(api, kind) {
  const c = (await api.circles()).find((x) => x.kind === kind);
  const p = await api.getPlayer();
  const r = Math.hypot(p.e - c.ce, p.n - c.cn);
  const want = ((Math.atan2(c.ce - p.e, c.cn - p.n) * 180) / Math.PI + 360) % 360; // azimuth to the middle
  const face = Math.abs(((p.heading - want + 540) % 360) - 180);
  const room = Math.min(...c.members.map((m) => Math.hypot(m.e - p.e, m.n - p.n)));
  return { c, p, r, face, room };
}

test('groups', async ({ page }) => {
  const api = T(page), rep = reporter('groups'), c = checks();
  await openGame(page, { query: 't=golden' });
  const step = (s) => api.advance(s, { dt: 1 / 60 });

  /* ---- the laughter club ---- */
  await api.toSpot('laugh');
  await step(0.2);
  let h = await api.getHud();
  c.ok(h.prompt.visible && h.prompt.text === 'E Join laughter club', `near the club the prompt reads "${h.prompt.text}"`);
  await page.keyboard.press('KeyE');
  await step(6); // they shuffle round to make room, and you step in
  let at = await placeIn(api, 'laugh');
  c.ok(at.p.state === 'in-group' && at.p.activity === 'group', `didn't join (${at.p.state} / ${at.p.activity})`);
  c.ok(Math.abs(at.r - at.c.r) < 0.3, `not on the circle: ${at.r.toFixed(2)} m from the middle (r ${at.c.r})`);
  c.ok(at.face < 12, `not facing the middle (${at.face.toFixed(1)}° off)`);
  c.ok(at.room > 1.3, `no gap opened: a member ${at.room.toFixed(2)} m away`);
  c.ok(at.c.joined, 'the circle doesn\'t know you joined');
  h = await api.getHud();
  c.ok(h.hint === GROUP_HINT, `hint bar in the group reads "${h.hint}"`);
  await rep.shot(page, 'laughter-club');
  // stay 30 s: still in it, the club still laughing (bursts come and go), your laughs and theirs
  const texts = new Set(), states = new Set(), bursts = new Set();
  for (let t = 0; t < 30; t += 0.25) {
    await step(0.25);
    const b = await api.bubble();
    if (b.visible) texts.add(b.text);
    states.add((await api.getPlayer()).state);
    bursts.add((await api.circles()).find((x) => x.kind === 'laugh').burst);
  }
  c.ok(states.size === 1 && states.has('in-group'), `in the club for 30 s the state went ${[...states]}`);
  c.ok(bursts.has(true) && bursts.has(false), `the club didn't keep laughing in bursts (${[...bursts]})`);
  c.ok([...texts].some((t) => /ha ha|hahaha/i.test(t)), `no laughing bubbles in 30 s: ${JSON.stringify([...texts])}`);
  c.ok(texts.has('Very good, very good, yay!'), `no chant between laughs: ${JSON.stringify([...texts])}`);
  at = await placeIn(api, 'laugh');
  c.ok(Math.abs(at.r - at.c.r) < 0.3 && at.face < 12, 'drifted out of place while in the circle');
  // Esc leaves (no pause); the circle closes up
  await page.keyboard.press('Escape');
  await step(0.2);
  let p = await api.getPlayer();
  h = await api.getHud();
  c.ok(p.state !== 'in-group' && !h.paused, `first Esc: state ${p.state}, paused ${h.paused}`);
  c.ok(h.hint === JOG_HINT, `after leaving the hint reads "${h.hint}"`);
  await step(8);
  const club = (await api.circles()).find((x) => x.kind === 'laugh');
  c.ok(!club.joined && club.members.every((m) => m.home), 'the circle didn\'t close up after you left');
  // the second Esc pauses as usual, and a third resumes
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await step(0.1);
  h = await api.getHud();
  c.ok(h.paused && h.card.visible, `second Esc didn't pause (${JSON.stringify({ paused: h.paused, card: h.card })})`);
  await page.keyboard.press('Escape');
  await step(0.1);
  c.ok(!(await api.getHud()).paused, 'Esc didn\'t resume');
  // join again, and leave with W
  await api.toSpot('laugh');
  await step(0.2);
  await page.keyboard.press('KeyE');
  await step(3);
  c.ok((await api.getPlayer()).state === 'in-group', 'couldn\'t join the club a second time');
  await page.keyboard.down('KeyW');
  await step(0.4);
  await page.keyboard.up('KeyW');
  p = await api.getPlayer();
  c.ok(p.state !== 'in-group' && !p.frozen, `W didn't leave the club (${p.state})`);

  /* ---- a chatting circle in the park ---- */
  const spot = await api.toSpot('chat');
  c.ok(!!spot, 'no chatting circle to join');
  if (spot) {
    await step(0.2);
    h = await api.getHud();
    c.ok(h.prompt.text === 'E Join group', `near a chatting circle the prompt reads "${h.prompt.text}"`);
    await page.keyboard.press('KeyE');
    await step(5);
    at = await placeIn(api, 'chat');
    c.ok(at.p.state === 'in-group' && Math.abs(at.r - at.c.r) < 0.3 && at.face < 12 && at.room > 0.9, `chat circle: ${JSON.stringify({ state: at.p.state, r: at.r, face: at.face, room: at.room })}`);
    await rep.shot(page, 'chat-circle');
    const said = new Set();
    for (let t = 0; t < 30; t += 0.25) { await step(0.25); const b = await api.bubble(); if (b.visible) said.add(b.text); }
    const nods = ['Haan ji!', 'Sahi baat hai.', 'Bilkul!', 'Hmm, haan.'];
    c.ok([...said].filter((t) => !nods.includes(t) && t !== 'Namaste ji!').length >= 2, `the group didn't chat: ${JSON.stringify([...said])}`);
    c.ok([...said].some((t) => nods.includes(t)), `you never nodded along: ${JSON.stringify([...said])}`);
    await page.keyboard.press('Escape');
    await step(0.2);
    c.ok((await api.getPlayer()).state !== 'in-group' && !(await api.getHud()).paused, 'Esc didn\'t leave the chatting circle');
  }

  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails });
  c.done(expect);
});
