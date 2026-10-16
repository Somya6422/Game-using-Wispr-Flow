/**
 * In-flight screen layout. Every element owns a zone so nothing overlaps and every button stays clickable:
 *
 *   ┌ mission objectives ┐     heading tape      ┌ COMMS + squad buttons ┐
 *   │                    │  warnings / banners   │  ILS (landing only)   │
 *   │ nav readouts       │   flight symbology    │                       │
 *   ├ DMS (bottom-left)  ┤   HUD text messages   ├ TSA (bottom-right)    ┤
 *   │                    │   radio subtitles     │                       │
 *   │                    │   step + pilot bar    │                       │
 *   └────────────────────┴   voice command bar   ┴───────────────────────┘
 *
 * The bottom-centre band sits between the two MFDs and is stacked upward from the voice bar: each element is placed
 * on top of the one below it using its measured height, so a growing voice log or a two-line subtitle pushes the
 * rest up instead of covering it. HUD canvas messages are drawn above the band (HUD.dockTop).
 */
export class FlightLayout {
  private active = false;
  private els: HTMLElement[] = [];

  constructor(private ids = { voice: 'voice', bar: 'pilotbar', sub: 'subtitle' }) {}

  private el(id: string) { return document.getElementById(id); }

  /** `mfdSide`: screen px each bottom MFD occupies from its screen edge (0 in clean mode). Returns the band's top (px). */
  apply(mfdSide: number): number {
    const voice = this.el(this.ids.voice), bar = this.el(this.ids.bar), sub = this.el(this.ids.sub);
    if (!voice || !bar || !sub) return window.innerHeight;
    this.active = true; this.els = [voice, bar, sub];
    const W = window.innerWidth, gap = 8;
    const bandW = Math.max(320, W - 2 * (mfdSide + 12));
    voice.style.width = `${Math.min(600, bandW)}px`;
    bar.style.maxWidth = `${bandW}px`;
    sub.style.maxWidth = `${bandW}px`;
    let bottom = 8;
    voice.style.bottom = `${bottom}px`;
    bottom += voice.offsetHeight + gap;
    bar.style.bottom = `${bottom}px`;
    if (bar.style.display !== 'none' && bar.offsetHeight > 0) bottom += bar.offsetHeight + gap;
    sub.style.bottom = `${bottom}px`;
    if (sub.classList.contains('show') && sub.offsetHeight > 0) bottom += sub.offsetHeight + gap;
    return window.innerHeight - bottom;
  }

  /** Leaving flight: hand positioning back to the stylesheet (menus, hangar and debrief have their own rules). */
  reset() {
    if (!this.active) return;
    this.active = false;
    for (const e of this.els) { e.style.bottom = ''; e.style.maxWidth = ''; e.style.width = ''; }
  }
}
