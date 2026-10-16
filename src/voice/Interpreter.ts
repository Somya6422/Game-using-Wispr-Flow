import { normalize, parseCommands, type Cmd } from './CommandParser';

/**
 * Forgiving front end for the command parser. People type and dictate messy English: typos ("trun lfet"), shorthand
 * ("pls gear dwn"), joined words ("gearup"), slang ("floor it"), broken order ("5000 feet climb") and filler
 * ("can you please make the jet go up a bit"). Each clause goes through increasingly loose readings and stops at the
 * first one the strict grammar accepts:
 *
 *   1. exact    – the text as typed (only spoken numbers and punctuation are normalised)
 *   2. fixed    – shorthand expanded, filler removed, everyday phrasing rewritten into command phrasing
 *   3. fixed    – plus spelling correction against the command vocabulary and splitting of joined words
 *   4. guess    – keyword match against known commands, in any word order; runs only when exactly one command fits
 *   5. unknown  – nothing fits; the closest commands are offered as suggestions
 *
 * Pure and deterministic, so it is unit-tested like the parser.
 */
export type How = 'exact' | 'fixed' | 'guess' | 'unknown';
export interface Clause { said: string; read: string; cmds: Cmd[]; how: How; suggest: string[] }
export interface Understanding { clauses: Clause[]; cmds: Cmd[] }

// ------------------------------------------------------------------ word lists
const words = (s: string) => s.trim().split(/\s+/);

/** every word the command grammar reacts to; spelling correction only ever lands on one of these */
const VOCAB = new Set(words(`
  abreast acquire afterburner afterburners aim aircraft airbrake airfield airspeed altitude angels angle arm ascend
  attack autoland autopilot backflip bandit bandits bank base bearing begin bogey bogeys boy brake brakes briefing
  burner burners camera campaign cancel cannon cease chaff chase check choose cinematic climb close closest cobra
  cockpit commands contact contacts continue control controls countermeasures course cover credits cruise cycle decoys
  decrease defend defensive degrees depart descend designate disengage dope drone drones east echelon ecm enemies enemy
  engage engine engines extend external faster feet fire firing flare flares flight flyby formation forward fox freeze
  front fuel full gear girl ground gun guns halt hangar heading height help hint hold home hostile hostiles hover idle
  increase infrared interact jammer jamming knots kulbit land landing launch left level lift lock lower maintain manual
  map maximum menu meters metres military missile missiles mission mouse navigate nearest north nose objective
  objectives open orbit overhead panic park pause percent pick pilot pitch power proceed protect radar radio range raise
  recover recovery reduce regroup rejoin release report request restart resume retract retry return right rise roll
  runway sabre saber scramble select settings shoot shortcuts sidewinder slower somersault south specter speed
  speedbrake spool start status steer stop stovl stow straight switch systems tactical tail takeoff target taxi tell
  throttle thrust tower trail turn unpause vertical view vtol vulcan waypoint weapon west wheel wheels wing wingman
  wings`));

const NUMBERS = new Set(words(`zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen
  sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand niner`));

/** everyday words that must never be "corrected" into a command word (near → gear, hit → hint, there → three…) */
const COMMON = new Set(words(`
  a an the to at of in on off up down and or then than my me i you your we us our it its is are am be been was were this
  that these those there their they them him her he she his what where when how why which who whom with without for
  from by about all any some more less much many very too so now here not no yes do does did done go going goes gone
  get got set put make made let lets can could would should will shall may might must want need have has had keep stay
  again back over under out into onto near far fast slow high low good bad ok okay please thanks thank like just still
  also only same other another next last first new old big small little bit time way side top bottom fly flying flew
  plane jet aircraft game play playing hit run see saw try use ask end max min sure well real really right left one
  two light night fight sight might bear hear fear near dear year head heat hand hard sharp quick slight gentle around
  away come came give gave take took tell said say look show find follow lead help stuck lost while until before after
  because if else but though yet ever never always maybe perhaps think know mean meant guess feel move moving turn
  turning going doing being having getting making taking coming looking`));

const KNOWN = new Set([...VOCAB, ...NUMBERS, ...COMMON]);

/** shorthand and very common slips, fixed everywhere (they can never be valid commands as typed) */
const SHORT: Record<string, string> = {
  u: 'you', ur: 'your', pls: 'please', plz: 'please', plez: 'please', pleas: 'please', pleae: 'please', plse: 'please',
  thx: 'thanks', hte: 'the', teh: 'the', adn: 'and', nad: 'and', nd: 'and', n: 'and', than: 'then', thn: 'then',
  thne: 'then', tehn: 'then', hten: 'then', im: 'i am', iam: 'i am', dont: 'do not', donot: 'do not', cant: 'can not',
  wont: 'will not', gonna: 'going to', wanna: 'want to', gotta: 'got to', lemme: 'let me', gimme: 'give me',
  fourty: 'forty', ninty: 'ninety', nintey: 'ninety', fivety: 'fifty', fifity: 'fifty', thousend: 'thousand',
  thousnd: 'thousand', thosand: 'thousand', thousands: 'thousand', hundered: 'hundred', hunderd: 'hundred',
  hundread: 'hundred', hundrad: 'hundred', hundreds: 'hundred', hundrd: 'hundred', eigth: 'eight',
  wheres: 'where is', hows: 'how is', thats: 'that is', theres: 'there is', whos: 'who is',
};

/** abbreviations and alternative spellings, expanded in the rewrite pass */
const ABBR: Record<string, string> = {
  alt: 'altitude', hdg: 'heading', hdng: 'heading', spd: 'speed', thr: 'throttle', thrtl: 'throttle',
  thrtle: 'throttle', thrott: 'throttle', ab: 'afterburner', 'a/p': 'autopilot', ap: 'autopilot', wp: 'waypoint',
  wpt: 'waypoint', wypt: 'waypoint', rwy: 'runway', msl: 'missile', msls: 'missiles', cam: 'camera', eng: 'engine',
  engs: 'engines', lt: 'left', lft: 'left', rt: 'right', rgt: 'right', rght: 'right', ryt: 'right', rite: 'right',
  deg: 'degrees', degs: 'degrees', dgr: 'degrees', fts: 'feet', feets: 'feet', foots: 'feet', mtr: 'meters',
  mtrs: 'meters', mts: 'meters', meter: 'meters', metre: 'meters', knts: 'knots', knot: 'knots', wpn: 'weapon',
  tgt: 'target', trgt: 'target', ldg: 'landing', lvl: 'level', rtn: 'return', ctrl: 'controls', ctrls: 'controls',
  trn: 'turn', clmb: 'climb', dsnd: 'descend', airport: 'airfield', airstrip: 'airfield', airbase: 'airfield',
  rocket: 'missile', rockets: 'missiles', plain: 'plane', gaer: 'gear', whels: 'wheels', dwn: 'down', dn: 'down',
  abort: 'cancel autopilot',
};

const swapWords = (s: string, map: Record<string, string>) =>
  s.split(' ').map(w => map[w] ?? w).join(' ');

// ------------------------------------------------------------------ edit distance
/** optimal-string-alignment Damerau–Levenshtein: a swap of two neighbouring letters counts as one typo */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v; rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** closest word of `pool` within the typo budget for this length; null when none or when two different words tie */
function nearest(w: string, pool: Iterable<string>): string | null {
  const budget = w.length <= 3 ? 1 : w.length <= 5 ? 1 : 2;
  let best: string[] = [], bestD = budget + 1;
  for (const v of pool) {
    if (w.length <= 3 && (v[0] !== w[0] || v.length > 4)) continue;   // tiny words: same first letter, one slip only
    const d = editDistance(w, v, budget);
    if (d < bestD) { bestD = d; best = [v]; } else if (d === bestD) best.push(v);
  }
  if (!best.length || bestD > budget) return null;
  if (bestD === 2 && !best.some(v => v[0] === w[0])) return null;          // two slips: keep the first letter
  if (best.length > 1) { const same = best.filter(v => v[0] === w[0]); if (same.length !== 1) return null; return same[0]; }
  return best[0];
}

// ------------------------------------------------------------------ passes
/** Safe clean-up applied to everything: case, apostrophes, digit grouping, "5k", "°", "&", stretched letters, shorthand, misspelt numbers. */
export function prep(text: string): string {
  let s = ` ${text.toLowerCase()} `;
  s = s.replace(/[’‘`´]/g, "'").replace(/([a-z])'([a-z])/g, '$1$2');
  s = s.replace(/(\d),(?=\d{3}\b)/g, '$1');
  s = s.replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, n: string) => String(Math.round(parseFloat(n) * 1000)));
  s = s.replace(/°/g, ' degrees ').replace(/\s*[&+]\s*/g, ' and ');
  s = s.replace(/(\d)(?!(?:st|nd|rd|th)\b)([a-z])/g, '$1 $2').replace(/\b([a-z]{3,})(\d)/g, '$1 $2');
  s = s.replace(/([a-z])\1{2,}/g, '$1$1');
  s = s.replace(/\s+/g, ' ').trim();
  return s.split(' ').map(tok => {
    const m = tok.match(/^([^a-z0-9']*)([a-z']+)([^a-z0-9']*)$/);
    if (!m) return tok;
    const w = m[2];
    if (SHORT[w]) return m[1] + SHORT[w] + m[3];
    if (w.length >= 5 && !KNOWN.has(w)) {
      // only when the word is closer to a number than to any command word ("heigt" stays for the speller → height)
      const n = nearest(w, NUMBERS);
      if (n && editDistance(w, n) < Math.min(...[...VOCAB].map(v => editDistance(w, v, 2)))) return m[1] + n + m[3];
    }
    return tok;
  }).join(' ');
}

type Rule = [RegExp, string | ((...a: string[]) => string)];
const ft = (unit?: string) => (unit && /^m/.test(unit) ? 'meters' : 'feet');

/** filler and politeness that carries no command meaning */
const FILLER: RegExp[] = [
  /\b(?:can|could|would|will) (?:you|ya)(?: please)?\b/g,
  /\b(?:i|we) (?:want|need|would like|wish|have|got)(?: you)?(?: to)?\b/g,
  /\b(?:i d|id) like(?: you)?(?: to)?\b/g,
  /\b(?:you|we) (?:need|have|got|should|must|gotta)(?: to)?\b/g,
  /\bgo ahead and\b|\btry (?:to|and)\b|\bmake sure (?:to|you)\b|\bi think\b|\bmaybe\b|\bfor me\b(?! and)/g,
  /\b(?:a (?:little )?bit|a little|little bit|a tad|slightly)\b/g,
  /\b(?:the|my|our|this|your) (?:jet|plane|aircraft|airplane|fighter|bird)\b/g,
  /\bmake (?:it |him |her )?(?=go\b|fly\b|turn\b|climb\b|descend\b|dive\b|move\b)/g,
  /\b(?:hey|hi|hello|yo|ok|okay|alright|um+|uh+|er+|hmm+|ah+|oh|so|well|like|just|actually|basically|really|literally|kindly|please|thanks|thank you|sir|bro|dude|buddy|mate|guys?|captain|now then|right away|asap|immediately|quickly|real quick)\b/g,
];

/** everyday phrasing → command phrasing. Order matters: specific rules first. */
const RULES: Rule[] = [
  // joins
  [/\bwing man\b/g, 'wingman'], [/\bauto pilot\b/g, 'autopilot'], [/\bafter ?burners?\b/g, 'afterburner'], [/\bway point\b/g, 'waypoint'],
  [/\bair ?speed\b/g, 'speed'], [/\bair field\b/g, 'airfield'], [/\btake of\b|\btak off\b|\btakeof\b/g, 'take off'],
  // negation
  [/\b(?:do not|never|no|stop|quit)\s+(?:fire|firing|shoot|shooting)\b/g, 'cease fire'],
  // autopilot
  [/\b(?:turn off|switch off|disable|deactivate|disengage|stop|kill|cancel|remove|exit|no)\s+(?:the\s+)?autopilot\b|\bautopilot\s+(?:off|stop|disable|disabled|no)\b|\bmanual (?:mode|flying|flight)\b|\blet me fly\b|\b(?:give me|i have|i take) (?:the )?controls?\b/g, 'autopilot off'],
  [/\b(?:turn on|switch on|enable|activate|engage|start|use|put on)\s+(?:the\s+)?autopilot\b|\bautopilot\b(?!\s+off)(?:\s+(?:on|engage|engaged|enable|mode))?|\bfly (?:it )?(?:yourself|by yourself|itself|on your own)\b|\bhands off\b|\bcruise control\b/g, 'level the wings'],
  // engines
  [/\b(?:turn on|switch on|power on|power up|fire up|start up|crank(?: up)?|ignite|boot up|start)\s+(?:the\s+|my\s+|both\s+)?(?:engines?|motors?|turbines?)\b|\b(?:engines?|motors?) (?:on|start|go)\b|\bignition\b/g, 'start engines'],
  [/^(?:start|start up|turn on|switch on|power on|power up|ignite|crank it|boot up)$/, 'start engines'],
  [/\b(?:cut|kill|stop|shut down|shut off|turn off)\s+(?:the\s+)?(?:engines?|motors?|power|throttle)\b|\bengines? off\b/g, 'idle'],
  [/\b(?:throttle|power|thrust) up\b/g, 'faster'], [/\b(?:throttle|power|thrust) down\b/g, 'slower'],
  // gear and brakes
  [/\b(?:open|deploy|drop|put down|lower|extend)\s+(?:the\s+)?(?:landing\s+)?(?:gear|wheels?)\b|\b(?:gear|wheels?)\s+(?:open|opened|deploy|deployed|lower|extend)\b/g, 'gear down'],
  [/\b(?:close|retract|raise|stow|pull up|put up|hide|tuck|pull in)\s+(?:the\s+)?(?:landing\s+)?(?:gear|wheels?)\b|\b(?:gear|wheels?)\s+(?:close|closed|retract|retracted|raise|stow|away)\b/g, 'gear up'],
  [/\b(?:parking brake|hand ?brake|e ?brake|hit the brakes|stop the wheels)\b/g, 'brakes on'],
  // take-off / landing / home
  [/\b(?:lift ?off|get (?:in the )?air(?:borne)?|go airborne|take to the (?:sky|skies|air)|leave the ground|fly away|departure|takeoff now)\b/g, 'take off'],
  [/\b(?:touch ?down|land (?:it|her|here|please)|put (?:it|her) down|(?:start|begin|initiate|go for|do|make)(?: a| the)? landing|lets land|time to land|go land|landing please|bring (?:her|it) (?:in|down)|auto ?landing)\b|^landing$/g, 'land now'],
  [/\b(?:go|fly|head|take me|bring me|return|get me|lets go)\s+(?:back\s+)?(?:home|to base|to the base|to (?:the )?airfield)\b|\bback to base\b|\breturn home\b/g, 'take me home'],
  [/\b(?:drive|roll) (?:to )?(?:the )?runway\b|\bgo to (?:the )?runway\b|^drive$/g, 'taxi'],
  // weapons (before "pull up"/"up" rules)
  [/\b(?:machine ?guns?|bullets?|gunz|minigun|autocannon|cannons?)\b/g, 'guns'],
  [/\b(?:heat ?seek(?:er|ing)?s?(?: missiles?)?|short range missiles?|aim ?9|ir missiles?)\b/g, 'ir missile'],
  [/\b(?:long range missiles?|radar guided missiles?|aim ?120|amraam|bvr missiles?)\b/g, 'radar missile'],
  [/\b(?:shoot|fire|launch|send)\s+(?:a\s+|the\s+|one\s+|1\s+|some\s+)?missiles?\b(?!\s*(?:radar|ir))/g, 'fire'],
  [/\b(?:shoot|blast|destroy|smoke|splash|nail|hit)\s+(?:him|them|it|that|the enemy|enemy|bandit|the target|target|down|em)\b/g, 'fire'],
  [/\b(?:dodge|evade|incoming|missile warning|break break|spoof|counter ?measures?|chaff and flares|pop (?:some )?(?:flares|chaff)|flare)\b/g, 'flares'],
  [/\bjam\b(?! (?:them|the radar|radar))/g, 'jammer'],
  // questions (before targets so "where is the enemy" is a report)
  [/\bwhere (?:is|are|s) (?:the |any )?(?:enemy|enemies|bad guys?|targets?|bandits?)\b|\bany (?:enemies|bandits|bad guys)\b|\benemy (?:location|position)s?\b|\bhow many (?:enemies|bandits|targets)\b/g, 'threat report'],
  [/\bwhere am i\b|\bmy (?:position|location)\b|\bwhere are we\b|\bhow am i doing\b|\bsitrep\b/g, 'status report'],
  [/\bhow (?:high|low) am i\b|\bhow high\b|\bmy (?:altitude|height)\b|^altitude$/g, 'what is my altitude'],
  [/\bhow fast\b|\bmy speed\b|\bcurrent speed\b|^speed$/g, 'what is my speed'],
  [/\bwhich (?:way|direction) am i\b|\bmy (?:heading|direction)\b|\bwhat direction\b|^heading$/g, 'what is my heading'],
  [/^(?:fuel|gas)$|\bhow much (?:fuel|gas)\b|\b(?:fuel|gas) (?:left|level)\b|\bam i (?:running )?(?:low on|out of) (?:fuel|gas)\b/g, 'fuel status'],
  // targets
  [/\b(?:find|get|show|pick|choose|lock onto|lock|aim at|track|switch)\s+(?:a\s+|an\s+|the\s+|me\s+(?:a\s+)?)?(?:new\s+|nearest\s+|closest\s+|next\s+|another\s+)?(?:targets?|enemy|enemies|bad guys?|bandits?|bogeys?|hostiles?)\b/g, 'next target'],
  // throttle and speed
  [/\bhalf (?:throttle|power|speed)\b/g, 'throttle 50 percent'],
  [/\b(?:floor it|punch it|gas it|step on it|full speed|max(?:imum)? speed|top speed|full send|boost|turbo|nitro|go fast|max throttle|throttle max|full gas|all power)\b/g, 'full power'],
  [/\b(?:accelerate|speed (?:it )?up|go faster|more speed|increase (?:the |my )?speed|raise (?:the |my )?speed)\b/g, 'faster'],
  [/\b(?:decelerate|slow (?:it )?down|reduce (?:the |my )?speed|lower (?:the |my )?speed|decrease (?:the |my )?speed|less speed|go slower|drop (?:the )?speed)\b|^slow$/g, 'slower'],
  [/\b(?:fly|go|cruise|hold|keep|stay)?\s*(?:at|to)?\s*(\d{2,3})\s*(?:knots|kts?)\b/g, (_m, n) => ` speed ${n} knots `],
  // altitude
  [/\bangels\s+(\d{1,2})\b/g, (_m, n) => `climb to ${parseInt(n) * 1000} feet`],
  [/\b(?:set |change |make )?(?:the )?(?:altitude|height|elevation)\s+(?:to\s+|at\s+|of\s+)?(\d{2,6})\s*(feet|ft|meters?|metres?|m)?\b/g, (_m, n, u) => `climb to ${n} ${ft(u)}`],
  [/\b(?:fly|cruise|stay|level off|level out|hold|maintain|keep|go)\s+(?:at\s+|to\s+)?(\d{3,6})\s*(feet|ft|meters?|metres?|m)\b/g, (_m, n, u) => `climb to ${n} ${ft(u)}`],
  [/^(?:to\s+)?(\d{3,6})\s*(feet|ft|meters?|metres?)$/, (_m, n, u) => `climb to ${n} ${ft(u)}`],
  [/^up (?:to )?(\d{3,6})/, 'climb to $1'], [/^down (?:to )?(\d{3,6})/, 'descend to $1'],
  [/\b(?:go|move|fly|pull|head|get)\s+(?:up|higher)\b|\bhigher\b|\bgain (?:height|altitude)\b|\bup up\b|^up$/g, 'climb'],
  [/\b(?:go|move|fly|head|get|come|push)\s+(?:down|lower)\b|\b(?:dive|nose ?dive|drop down|lower (?:the )?altitude|lose height|decend|desend|dissent)\b|^down$|^lower$/g, 'descend'],
  // turning
  [/\b(?:u ?turn|turn around|turn back|reverse(?: course| direction)?|about face|opposite (?:way|direction)|go the other way|(?:do|pull|make) (?:a )?180)\b|^180$/g, 'turn right 180'],
  [/\b(?:hard|sharp)\s+(left|right)\b(?!\s*\d)/g, 'turn $1 60'],
  [/\b(?:slight|small|gentle|little)\s+(left|right)\b(?!\s*\d)/g, 'turn $1 15'],
  [/\b(?:go|move|steer|veer|swing|break|yaw|head|bear|hang|take|make|do|fly|turn)\s+(?:a\s+)?(?:to the\s+)?(left|right)\b/g, 'turn $1'],
  [/\b(?:to the|towards the|toward the)\s+(left|right)\b/g, '$1'],
  [/\b(\d{1,3})\s*(?:degrees?\s*)?(?:to (?:the |my )?)?(left|right)\b/g, (m, n, d, _o, all) => (/\b(bank|roll)\b/.test(all) ? m : `turn ${d} ${n}`)],
  [/^(left|right)(?: (\d{1,3}))?(?: degrees?)?$/, (_m, d, n) => `turn ${d}${n ? ' ' + n : ''}`],
  [/\bturn (?:to|heading) (\d{1,3})\b/g, 'heading $1'],
  [/\bturn (\d{1,3})\b(?! *(?:degrees? )?(?:left|right))/g, 'turn right $1'],
  [/\bnorth ?east\b/g, 'heading 45'], [/\bsouth ?east\b/g, 'heading 135'], [/\bsouth ?west\b/g, 'heading 225'], [/\bnorth ?west\b/g, 'heading 315'],
  [/\b(?:face|point|aim|direction|bearing|vector|head|go to|fly to)\s+(?:to\s+|at\s+)?(\d{1,3})\b(?!\s*(?:feet|ft|meters?|metres?|knots|percent|kts?|m)\b)/g, 'heading $1'],
  [/\btilt (up|down)\b/g, 'nose $1'],
  // attitude helpers
  [/\b(?:fly straight|go straight|straight ahead|stop turning|steady|stabili[sz]e|balance|level out|level off)\b/g, 'level the wings'],
  [/\bstay (?:at )?(?:this |the |current )?(altitude|height|heading|course)\b/g, 'hold $1'],
  [/\b(?:keep going|keep flying|maintain course|stay on course)\b/g, 'hold heading'],
  [/\b(?:crashing|crash|stall|stalling|pull out|save the plane|emergency|mayday|falling|out of control)\b/g, 'recover'],
  // wingman
  [/\b(?:follow me|stick with me|stay with me|come with me|come back|come here|get back here|with me)\b/g, 'rejoin'],
  [/\b(?:back me up|help me (?:fight|out)|support me|cover my (?:six|back|tail)|guard me|escort me)\b/g, 'cover me'],
  [/^(?:attack|go get (?:him|them|em)|sic (?:him|them|em)|kill (?:him|them|em)|get (?:him|them|em)|take (?:him|them|em) out)$/, 'engage'],
  // camera
  [/\b(?:first person|1st person|inside view|pilot view|pov|in the cockpit|cockpit cam)\b|^inside$/g, 'cockpit view'],
  [/\b(?:third person|3rd person|behind (?:the jet|me)|outside view|normal view|default view)\b|^outside$/g, 'chase view'],
  [/\b(?:top view|top down|birds? eye|from above|map view|zoom out)\b/g, 'tactical view'],
  [/\b(?:toggle|swap|other|different|another|cycle|rotate|change)\s+(?:the\s+)?(?:camera|view|cam|angle)\b|\b(?:camera|view)\s+(?:change|switch|next)\b|^(?:camera|view|cam)$/g, 'next camera'],
  [/\b(?:look at|watch|focus on)\s+(?:the\s+)?(?:target|enemy)\b/g, 'target camera'],
  [/\b(?:movie mode|film mode|cinematic mode)\b|^cinematic$/g, 'cinematic camera'],
  [/\bmouse(?: control| mode| steering| flying)?\s+(on|off)\b/g, 'mouse aim $1'],
  [/\b(?:use (?:the )?mouse|fly with (?:the )?mouse|mouse steering)\b/g, 'mouse aim on'],
  // game
  [/\b(?:quit|exit|leave)(?:\s+(?:the\s+)?(?:game|mission|flight))?$|\b(?:home screen|title screen|go to main)\b/g, 'main menu'],
  [/\b(?:try again|start over|redo|reset (?:the )?mission)\b/g, 'restart'],
  [/\b(?:wait|hold up|one sec(?:ond)?|brb|stop the game|pause (?:the )?game)\b/g, 'pause'],
  [/^(?:go on|play on|back to it|unfreeze)$/, 'resume'],
  [/\b(?:preferences|config|volume|graphics|audio settings|sound settings)\b/g, 'settings'],
  [/\b(?:goals?|tasks?|mission (?:goals?|tasks?|info))\b/g, 'objectives'],
  [/^(?:waypoint|navigate|objective|route|follow (?:the )?route|next point|go to (?:the )?objective)$/, 'fly to the next waypoint'],
  [/\b(?:how (?:do i|to) (?:play|fly|control)|teach me|tutorial|tips?)\b|^(?:help|idk|i do not know|i am stuck|stuck|confused|what next|now what|next step|what is next|what)$/g, 'hint'],
  [/\b(?:list (?:of )?commands|all commands|what can i (?:say|do|type)|show (?:me )?(?:the )?keys|key list|how to control)\b|^commands$/g, 'show the commands'],
];

/** filler removal plus everyday-phrasing rewrites */
export function rewrite(clause: string): string {
  let s = ` ${swapWords(clause, ABBR)} `;
  for (const f of FILLER) s = ` ${s.replace(f, ' ').replace(/\s+/g, ' ').trim()} `;
  s = s.trim();
  for (const [re, to] of RULES) {
    s = typeof to === 'string' ? s.replace(re, to) : s.replace(re, to as (...a: string[]) => string);
    s = s.replace(/\s+/g, ' ').trim();
  }
  return s;
}

const SPLIT_PARTS = new Set([...VOCAB, ...NUMBERS, ...words('up down on off in out to the me my now all more less go it max full next')]);

/** spelling correction against the command vocabulary; also splits "gearup" and joins "land ing" */
export function spell(clause: string): string {
  const toks = clause.split(' ').filter(Boolean), out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (!/^[a-z]+$/.test(w) || KNOWN.has(w)) { out.push(w); continue; }
    if (ABBR[w]) { out.push(ABBR[w]); continue; }
    const nx = toks[i + 1];
    if (nx && /^[a-z]+$/.test(nx) && VOCAB.has(w + nx)) { out.push(w + nx); i++; continue; }
    let split: string | null = null;
    if (w.length >= 5) for (let k = 2; k <= w.length - 2; k++) {
      const a = w.slice(0, k), b = w.slice(k);
      if (SPLIT_PARTS.has(a) && SPLIT_PARTS.has(b) && (VOCAB.has(a) || VOCAB.has(b))) { split = `${a} ${b}`; break; }
    }
    if (split) { out.push(split); continue; }
    out.push(nearest(w, VOCAB) ?? nearest(w, COMMON) ?? (w.length >= 5 ? nearest(w, NUMBERS) : null) ?? w);
  }
  return out.join(' ');
}

// ------------------------------------------------------------------ keyword guess
type Template = { say: string; withN?: string; keys: string[][]; suggestOnly?: boolean };
const T = (say: string, keys: string, withN?: string, suggestOnly = false): Template =>
  ({ say, withN, keys: keys.split(' ').map(k => k.split('|')), suggestOnly });

/** command phrases the guesser can land on; every `say`/`withN` parses with the strict grammar */
const TEMPLATES: Template[] = [
  T('gear down', 'gear|wheels|wheel down|lower|extend|open|out|deploy'),
  T('gear up', 'gear|wheels|wheel up|raise|retract|close|stow|in'),
  T('turn left', 'turn|go|steer|head|move|veer|yaw|direction left', 'turn left {n} degrees'),
  T('turn right', 'turn|go|steer|head|move|veer|yaw|direction right', 'turn right {n} degrees'),
  T('bank left', 'bank|roll left', 'bank left {n}'), T('bank right', 'bank|roll right', 'bank right {n}'),
  T('climb', 'climb|ascend|higher|rise|altitude|height', 'climb to {n} {u}'),
  T('descend', 'descend|dive|lower|drop', 'descend to {n} {u}'),
  T('what is my heading', 'heading|course|direction|bearing', 'heading {n}'),
  T('faster', 'throttle|power|thrust', 'throttle {n} percent'),
  T('what is my speed', 'speed|knots', 'hold speed {n} knots'),
  T('full power', 'full|max|maximum power|throttle|thrust|speed'),
  T('afterburner on', 'afterburner|burner|boost'),
  T('idle', 'idle'), T('faster', 'faster|accelerate'), T('slower', 'slower|decelerate|slow'),
  T('take off', 'takeoff|lift|depart'),
  T('land now', 'land|landing|touchdown|autoland'),
  T('take me home', 'home|base|rtb'),
  T('fly to the next waypoint', 'waypoint|objective|nav|navigate'),
  T('level the wings', 'level|straight|steady|autopilot'),
  T('autopilot off', 'autopilot off|disable|stop|manual'),
  T('start engines', 'start|ignite|ignition|spool engine|engines'),
  T('taxi to the runway', 'taxi'),
  T('fire', 'fire|shoot|launch|kill'),
  T('switch to guns', 'guns|gun|cannon'),
  T('select ir missiles', 'ir|infrared|heat|sidewinder'),
  T('select radar missiles', 'radar missile|missiles'),
  T('next target', 'target|lock|enemy|bandit|bogey'),
  T('deploy flares', 'flares|flare|chaff|countermeasures|decoys'),
  T('cease fire', 'cease|hold|stop fire|firing|shooting'),
  T('cover me', 'cover|protect|defend|defensive'),
  T('rejoin formation', 'rejoin|regroup|follow|formation'),
  T('wingman engage', 'wingman|specter engage|attack|kill|get'),
  T('airbrake on', 'airbrake|speedbrake'), T('brakes on', 'brake|brakes'),
  T('recover', 'recover|recovery|spin|panic'),
  T('cobra', 'cobra|pugachev'), T('kulbit', 'kulbit|somersault|backflip'), T('hover', 'hover|vtol|stovl'), T('ecm on', 'ecm|jammer|jamming'),
  T('what is my altitude', 'altitude|height how|what|check|my'),
  T('fuel status', 'fuel|gas'),
  T('threat report', 'enemies|enemy|bandits|threats|contacts|hostiles where|report|any'),
  T('status report', 'status|report|sitrep|systems'),
  T('next camera', 'camera|view|cam|angle'),
  T('cockpit view', 'cockpit|inside'), T('chase view', 'chase|outside|behind'),
  T('open the map', 'map|chart'), T('pause', 'pause|freeze'), T('resume', 'resume|unpause|continue', undefined, true),
  T('hint', 'hint|help|stuck|tip'), T('show the commands', 'commands|controls|keys|shortcuts|keyboard'),
  T('restart', 'restart|retry'), T('main menu', 'menu|quit|exit'), T('settings', 'settings|options'),
  T('hangar', 'hangar'), T('objectives', 'objectives|objective|mission'),
  T('launch the mission', 'launch|play|begin|mission', undefined, true),
  T('continue campaign', 'continue|load|campaign', undefined, true),
  T('new campaign', 'new campaign|game'),
];

const stem = (w: string) => (w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, '') : w);
const tokMatch = (tok: string, key: string) => tok === key || stem(tok) === stem(key) || (tok.length >= 5 && key.length >= 5 && editDistance(tok, key, 1) <= 1);

/** keyword match in any word order. `auto`: the one command that clearly fits; `suggest`: closest candidates. */
export function guess(clause: string): { auto: string | null; suggest: string[] } {
  const toks = clause.split(' ').filter(Boolean);
  const n = clause.match(/\b(\d{1,6})\b/)?.[1];
  const unit = /\b(m|meters?|metres?)\b/.test(clause) ? 'meters' : 'feet';
  const scored: { say: string; score: number; hit: number; auto: boolean }[] = [];
  for (const t of TEMPLATES) {
    const hit = t.keys.filter(alts => toks.some(tok => alts.some(a => tokMatch(tok, a)))).length;
    if (!hit) continue;
    const say = n && t.withN ? t.withN.replace('{n}', n).replace('{u}', unit) : t.say;
    scored.push({ say, score: hit / t.keys.length, hit, auto: !t.suggestOnly });
  }
  scored.sort((a, b) => b.score - a.score || b.hit - a.hit);
  const seen = new Set<string>(), suggest: string[] = [];
  for (const s of scored) if (s.score >= 0.5 && !seen.has(s.say)) { seen.add(s.say); suggest.push(s.say); }
  const top = scored.filter(s => s.score === 1);
  const best = top.length ? top.filter(s => s.hit === top[0].hit) : [];
  const unique = new Set(best.map(s => s.say));
  // a guess is acted on only when exactly one command fits completely and most of what was said is accounted for
  const content = toks.filter(w => !COMMON.has(w) && !/^\d+$/.test(w)).length;
  const auto = unique.size === 1 && best[0].auto && content - best[0].hit <= 1 ? best[0].say : null;
  return { auto, suggest: suggest.slice(0, 3) };
}

// ------------------------------------------------------------------ clauses
const RADIO = /^(?:tell|ask|radio|say to|message|broadcast to)\b/;
const ADDRESSEE = /^(?:specter(?: \d| one| two)?|wingman|ground|tower|control|\d)$/;
const good = (cs: Cmd[]) => cs.length > 0 && cs.every(c => c.t !== 'unknown');
/** a "radio" result the grammar fell back to only because a call sign word appeared somewhere in the clause */
const weakRadio = (cs: Cmd[], s: string) => cs.length === 1 && cs[0].t === 'radio' && !/^(?:tell|ask|radio|say to|message|broadcast to|ground|tower|control|specter|wingman)\b/.test(s);

const NEGATED = /\b(?:do not|never|dont)\b/;

function readClause(said: string): Clause | null {
  const s0 = normalize(said);
  if (!s0) return null;
  // "don't shoot" must never fire: only the rewrite rules (→ "cease fire", "autopilot off") may act on a negation
  if (NEGATED.test(s0)) {
    const s1 = rewrite(s0), c = parseCommands(s1);
    if (!NEGATED.test(s1) && good(c)) return { said, read: s1, cmds: c, how: 'fixed', suggest: [] };
    return { said, read: s1, cmds: [{ t: 'unknown', raw: said }], how: 'unknown', suggest: ['cease fire', 'autopilot off'] };
  }
  const strict = parseCommands(s0);
  if (good(strict) && !weakRadio(strict, s0)) return { said, read: s0, cmds: strict, how: 'exact', suggest: [] };
  const fallbackRadio = good(strict) ? strict : null;

  const s1 = rewrite(s0);
  if (!s1) return fallbackRadio ? { said, read: s0, cmds: fallbackRadio, how: 'exact', suggest: [] } : null;   // only filler ("ok thanks")
  const try1 = s1 !== s0 ? parseCommands(s1) : [];
  if (good(try1) && !weakRadio(try1, s1)) return { said, read: s1, cmds: try1, how: 'fixed', suggest: [] };

  const s2 = rewrite(normalize(spell(s1)));
  const try2 = s2 !== s1 ? parseCommands(s2) : [];
  if (good(try2) && !weakRadio(try2, s2)) return { said, read: s2, cmds: try2, how: 'fixed', suggest: [] };

  const g = guess(s2);
  if (g.auto) { const c = parseCommands(g.auto); if (good(c)) return { said, read: g.auto, cmds: c, how: 'guess', suggest: [] }; }
  if (fallbackRadio) return { said, read: s0, cmds: fallbackRadio, how: 'exact', suggest: [] };
  return { said, read: s2, cmds: [{ t: 'unknown', raw: said }], how: 'unknown', suggest: g.suggest };
}

/** Splits an utterance into clauses (sentences, commas, "and", "then"…) and reads each as forgivingly as needed. */
export function understand(text: string): Understanding {
  const raw = text.trim();
  if (!raw) return { clauses: [], cmds: [] };
  const p = prep(raw);
  // a message addressed to somebody is one command, never split or rewritten
  const msg = p.replace(/^(?:hey|ok|okay|so|um|uh)[\s,]+/, '');
  if (RADIO.test(msg)) {
    const cmds = parseCommands(raw.replace(/^\s*(?:hey|ok|okay|so|um|uh)[\s,]+/i, ''));
    return { clauses: [{ said: raw, read: raw, cmds, how: 'exact', suggest: [] }], cmds };
  }
  const pieces: string[] = [];
  for (const sentence of p.split(/[.;!?\n]+|,(?!\d)/)) {
    const norm = normalize(sentence);
    if (!norm) continue;
    for (const part of norm.split(/\b(?:and then|and also|after that|afterwards|followed by|then|and)\b/)) {
      const t = part.trim();
      if (t) pieces.push(t);
    }
  }
  // "specter two, engage my target": a bare call sign belongs to the clause after it
  const merged: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (ADDRESSEE.test(pieces[i]) && i + 1 < pieces.length) { pieces[i + 1] = `${pieces[i]} ${pieces[i + 1]}`; continue; }
    merged.push(pieces[i]);
  }
  const clauses = merged.map(readClause).filter((c): c is Clause => !!c);
  const known = clauses.filter(c => c.how !== 'unknown');
  const cmds = known.length ? known.flatMap(c => c.cmds) : clauses.flatMap(c => c.cmds);
  return { clauses, cmds };
}
