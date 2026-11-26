// DOM overlay: info bar, time controls, build bar, selection panel, ghost label.

import * as THREE from 'three';
import { BUILDINGS, BUILD_BAR } from '../data/buildings';
import { ITEMS, ITEM_IDS, type ItemId } from '../data/items';
import { RECIPES, type RecipeDef } from '../data/recipes';
import { TICK_RATE } from '../data/tunables';
import type { Game, Speed } from '../game';
import type { Tools } from '../input/tools';
import type { GhostView } from '../render/ghost';
import type { GroundView } from '../render/ground-view';
import { ITEM_COLOURS, css } from '../render/palette';
import { craftTicks } from '../sim/prod';
import type { Building, Slot } from '../sim/types';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function itemName(item: ItemId) {
  return ITEMS[item].name.toLowerCase();
}

function dot(item: ItemId) {
  return `<span class="dot" style="background:${css(ITEM_COLOURS[item])}"></span>`;
}

export function statusText(b: Building): string {
  switch (b.status) {
    case 'working':
      return 'Working';
    case 'idle':
      return 'Idle';
    case 'starved':
      return b.missing ? `Starved: needs ${itemName(b.missing)}` : 'Starved';
    case 'blocked':
      return 'Blocked: output full';
    case 'unpowered':
      return 'Unpowered';
  }
}

export function recipeText(r: RecipeDef, b?: Building): string {
  const side = (m: Partial<Record<ItemId, number>>) =>
    (Object.entries(m) as [ItemId, number][]).map(([i, n]) => `${n} ${itemName(i)}`).join(' + ');
  if (r.extract) return `${r.extract} ${b?.extracts ? itemName(b.extracts) : 'raw item'} every ${r.time} s`;
  return `${side(r.inputs)} → ${side(r.outputs) || `${r.power} power`}, ${r.time} s`;
}

export class Hud {
  private root = document.getElementById('ui')!;
  private info = el('div', 'panel info', this.root);
  private infoText = el('span', '', this.info);
  private help = el('div', 'panel help', this.root);
  /** Called when the player picks a scenario from the menu. */
  onScenario: (name: string) => void = () => {};
  private scenarioSel!: HTMLSelectElement;
  private time = el('div', 'panel time', this.root);
  private bar = el('div', 'panel bar', this.root);
  private hint = el('div', 'hint', this.root);
  private side = el('div', 'panel side', this.root);
  private label = el('div', 'ghost-label', this.root);
  private toast = el('div', 'toast', this.root);
  private toastUntil = 0;
  private lastSide = '';
  private lastInfo = '';
  private acc = 0;

  constructor(
    private game: Game,
    private tools: Tools,
    private ghost: GhostView,
    private camera: THREE.Camera,
    private ground: GroundView,
  ) {
    this.buildTime();
    this.buildBar();
    this.buildInfo();
    this.side.addEventListener('click', (e) => this.onSideClick(e));
    tools.onChange = () => this.refreshTools();
    tools.onMessage = (t) => this.message(t);
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.setSpeed(this.game.speed === 0 ? this.resumeSpeed : 0);
      } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        this.setSpeed(this.game.speed === 0 ? 1 : (Math.min(4, this.game.speed * 2) as Speed));
      } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        this.setSpeed(this.game.speed <= 1 ? 0 : ((this.game.speed / 2) as Speed));
      }
    });
    this.refreshTools();
  }

  private resumeSpeed: Speed = 1;

  setSpeed(s: Speed) {
    if (s !== 0) this.resumeSpeed = s;
    this.game.speed = s;
    for (const b of this.time.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.speed) === s);
  }

  private buildInfo() {
    el('span', 'sep', this.info);
    const sel = el('select', '', this.info);
    sel.id = 'scenario';
    sel.title = 'Start over with a scenario';
    for (const [v, label] of [
      ['', 'Empty map'],
      ['m2', 'Mine chain'],
      ['m3-gap', 'Narrow gap, 30 haulers'],
      ['m1', 'One of each, filled by hand'],
    ]) {
      const o = el('option', '', sel);
      o.value = v;
      o.textContent = label;
    }
    sel.onchange = () => {
      this.onScenario(sel.value);
      sel.blur();
    };
    this.scenarioSel = sel;
    const hb = el('button', '', this.info);
    hb.textContent = '?';
    hb.title = 'Controls (H)';
    hb.onclick = () => this.toggleHelp();
    this.help.innerHTML = `
      <h3>Controls</h3>
      <dl>
        <dt>Pan</dt><dd>WASD, arrow keys or middle-drag</dd>
        <dt>Zoom</dt><dd>Mouse wheel</dd>
        <dt>Rotate</dt><dd>Q / E or right-drag</dd>
        <dt>Build</dt><dd>1 extractor (on a deposit), 2 smelter, 3 fabricator</dd>
        <dt>Rotate building</dt><dd>R or right-drag while placing; Shift places without snapping</dd>
        <dt>Select</dt><dd>Click a building; Esc to clear</dd>
        <dt>Demolish</dt><dd>X, then click</dd>
        <dt>Traffic overlay</dt><dd>T</dd>
        <dt>Speed</dt><dd>Space pauses; + and − change speed</dd>
      </dl>
      <p>Haulers carry everything by themselves. Busy routes wear into tracks, then roads.
      Select the hub to add haulers.</p>`;
    this.help.hidden = true;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH' && !e.ctrlKey && !e.metaKey && !e.altKey && (e.target as HTMLElement).tagName !== 'INPUT') this.toggleHelp();
    });
  }

  toggleHelp(on = this.help.hidden) {
    this.help.hidden = !on;
  }

  setScenario(name: string) {
    if (this.scenarioSel) this.scenarioSel.value = name;
    this.lastSide = '';
  }

  private buildTime() {
    const speeds: [Speed, string, string][] = [
      [0, 'Pause', 'Space'],
      [1, '×1', ''],
      [2, '×2', ''],
      [4, '×4', ''],
    ];
    for (const [s, label, key] of speeds) {
      const b = el('button', '', this.time);
      b.textContent = label;
      b.dataset.speed = String(s);
      b.title = key ? `${label} (${key})` : `${label} (+/-)`;
      b.onclick = () => this.setSpeed(s);
    }
    this.setSpeed(this.game.speed);
  }

  private buildBar() {
    for (const type of BUILD_BAR) {
      const def = BUILDINGS[type];
      const b = el('button', '', this.bar);
      b.innerHTML = `<span class="key">${def.hotkey ?? ''}</span>${def.name}`;
      b.title = def.blurb;
      b.dataset.tool = type;
      b.onclick = () => {
        const t = this.tools.st.tool;
        this.tools.setTool(t.kind === 'place' && t.type === type ? { kind: 'select' } : { kind: 'place', type });
      };
    }
    el('span', 'sep', this.bar);
    const d = el('button', '', this.bar);
    d.innerHTML = `<span class="key">X</span>Demolish`;
    d.dataset.tool = 'demolish';
    d.onclick = () => this.tools.setTool(this.tools.st.tool.kind === 'demolish' ? { kind: 'select' } : { kind: 'demolish' });
    el('span', 'sep', this.bar);
    const t = el('button', '', this.bar);
    t.innerHTML = `<span class="key">T</span>Traffic`;
    t.title = 'Overlay: tracks, roads, crowding and where each hauler is going.';
    t.dataset.overlay = 'traffic';
    t.onclick = () => this.toggleTraffic();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey && !e.altKey && (e.target as HTMLElement).tagName !== 'INPUT') this.toggleTraffic();
    });
  }

  toggleTraffic(on = !this.ground.overlay) {
    this.ground.setOverlay(on);
    this.bar.querySelector('[data-overlay="traffic"]')?.classList.toggle('on', on);
  }

  private refreshTools() {
    const t = this.tools.st.tool;
    for (const b of this.bar.querySelectorAll('button')) {
      const on = (t.kind === 'place' && b.dataset.tool === t.type) || (t.kind === 'demolish' && b.dataset.tool === 'demolish');
      b.classList.toggle('on', on);
    }
    if (t.kind === 'place') {
      this.hint.textContent = 'Click to place. R or right-drag to rotate. Hold Shift to place without snapping. Esc or right-click to stop.';
    } else if (t.kind === 'demolish') {
      this.hint.textContent = 'Click a building to demolish it. Esc to stop.';
    } else this.hint.textContent = '';
    this.hint.style.display = this.hint.textContent ? '' : 'none';
    this.lastSide = '';
  }

  message(text: string) {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    this.toastUntil = performance.now() + 2500;
  }

  private onSideClick(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const id = this.tools.st.selected;
    const a = btn.dataset.action;
    let res: { ok: boolean; reason?: string } | null = null;
    if (a === 'recipe' && id !== null) res = this.game.command({ type: 'setRecipe', id, recipe: btn.dataset.recipe as never });
    if (a === 'fill' && id !== null) res = this.game.command({ type: 'debugFill', id });
    if (a === 'clear' && id !== null) res = this.game.command({ type: 'debugClearOutputs', id });
    if (a === 'haulers') res = this.game.command({ type: 'debugAddHaulers', count: Number(btn.dataset.n ?? 1) });
    if (a === 'demolish' && id !== null) {
      res = this.game.command({ type: 'demolish', id });
      if (res.ok) this.tools.select(null);
    }
    if (res && !res.ok && res.reason) this.message(res.reason);
    this.lastSide = '';
  }

  /** Per frame. Text panels refresh at about 10 Hz. */
  update(dt: number) {
    // Ghost label follows the ghost.
    const st = this.tools.st;
    if (st.tool.kind === 'place' && st.pose && !st.valid && st.reason) {
      const p = this.ghost.labelAt.clone().project(this.camera);
      this.label.style.display = '';
      this.label.textContent = st.reason;
      this.label.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
      this.label.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
    } else this.label.style.display = 'none';

    if (this.toastUntil && performance.now() > this.toastUntil) {
      this.toast.style.opacity = '0';
      this.toastUntil = 0;
    }

    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    this.updateInfo();
    this.updateSide();
  }

  private updateInfo() {
    const s = this.game.sim.state;
    const secs = Math.floor(s.tick / TICK_RATE);
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const total = s.haulers.length;
    const busy = s.haulers.filter((h) => h.job !== null).length;
    const html = `<span class="mono">${clock}</span><span class="sep"></span>Haulers <span class="mono">${busy}/${total}</span> busy`;
    if (html !== this.lastInfo) {
      this.infoText.innerHTML = html;
      this.lastInfo = html;
    }
  }

  private updateSide() {
    const id = this.tools.st.selected;
    const b = id !== null ? this.game.sim.d.byId.get(id) : undefined;
    if (!b) {
      this.side.style.display = 'none';
      this.lastSide = '';
      return;
    }
    const html = b.type === 'hub' ? this.hubPanel(b) : this.buildingPanel(b);
    if (html !== this.lastSide) {
      this.side.innerHTML = html;
      this.lastSide = html;
    }
    this.side.style.display = '';
  }

  private slotRow(item: ItemId, s: Slot, kind: 'in' | 'out') {
    const extra = s.r > 0 ? (kind === 'in' ? `${s.r} on the way` : `${s.r} promised`) : '';
    const cap = s.cap > 0 ? ` / ${s.cap}` : '';
    return `<div class="row">${dot(item)}<span class="grow">${ITEMS[item].name}</span><span class="mono">${s.n}${cap}</span><span class="note">${extra}</span></div>`;
  }

  private buildingPanel(b: Building) {
    const def = BUILDINGS[b.type];
    const r = b.recipe ? RECIPES[b.recipe] : null;
    let h = `<h2>${def.name}</h2>`;
    h += `<div class="status s-${b.status}"><span class="lamp"></span>${esc(statusText(b))}</div>`;
    if (def.recipes.length > 1) {
      h += `<div class="recipes">`;
      for (const rid of def.recipes) {
        h += `<button data-action="recipe" data-recipe="${rid}" class="${rid === b.recipe ? 'on' : ''}">${RECIPES[rid].name}</button>`;
      }
      h += `</div>`;
    }
    if (r) {
      h += `<div class="recipe">${esc(recipeText(r, b))}</div>`;
      const p = b.crafting ? b.progress / craftTicks(r) : 0;
      h += `<div class="progress"><div style="width:${(p * 100).toFixed(0)}%"></div></div>`;
    }
    const ins = Object.entries(b.inp) as [ItemId, Slot][];
    const outs = Object.entries(b.out) as [ItemId, Slot][];
    if (ins.length) h += `<h3>Input</h3>` + ins.map(([i, s]) => this.slotRow(i, s, 'in')).join('');
    if (outs.length) h += `<h3>Output</h3>` + outs.map(([i, s]) => this.slotRow(i, s, 'out')).join('');
    h += `<div class="row made"><span class="grow">Made</span><span class="mono">${b.made}</span></div>`;
    h += `<div class="buttons">`;
    if (ins.length) h += `<button data-action="fill" class="debug">Fill inputs</button>`;
    if (outs.length) h += `<button data-action="clear" class="debug">Clear outputs</button>`;
    h += `<button data-action="demolish">Demolish</button></div>`;
    return h;
  }

  private hubPanel(b: Building) {
    const s = this.game.sim.state;
    let h = `<h2>Hub</h2>`;
    const busy = s.haulers.filter((x) => x.job !== null).length;
    h += `<div class="row"><span class="grow">Haulers</span><span class="mono">${s.haulers.length}</span><span class="note">${busy} busy</span></div>`;
    h += `<h3>Stored</h3>`;
    let any = false;
    for (const item of ITEM_IDS) {
      const sl = b.store?.[item];
      if (!sl || (sl.n === 0 && sl.r === 0)) continue;
      any = true;
      const extra = sl.r > 0 ? `${sl.r} promised` : '';
      h += `<div class="row">${dot(item)}<span class="grow">${ITEMS[item].name}</span><span class="mono">${sl.n}</span><span class="note">${extra}</span></div>`;
    }
    if (!any) h += `<div class="row note">Nothing yet.</div>`;
    h += `<div class="buttons"><button data-action="haulers" data-n="1" class="debug">Add hauler</button><button data-action="haulers" data-n="5" class="debug">Add 5</button></div>`;
    return h;
  }
}
