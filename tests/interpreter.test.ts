import { describe, expect, it } from 'vitest';
import { editDistance, understand } from '../src/voice/Interpreter';

const cmds = (s: string) => understand(s).cmds;
const one = (s: string) => cmds(s)[0];
const how = (s: string) => understand(s).clauses.map(c => c.how);

describe('forgiving command interpreter', () => {
  it('counts a swapped letter pair as one typo', () => {
    expect(editDistance('trun', 'turn')).toBe(1);
    expect(editDistance('gaer', 'gear')).toBe(1);
    expect(editDistance('throtle', 'throttle')).toBe(1);
  });

  it('leaves well-formed commands exactly as the strict grammar reads them', () => {
    expect(one('gear down')).toEqual({ t: 'gear', down: true });
    expect(how('heading two seventy')).toEqual(['exact']);
    expect(one('heading two seventy')).toEqual({ t: 'heading', deg: 270 });
    expect(one('tell ground we are inbound')).toMatchObject({ t: 'radio', to: 'ground', text: 'we are inbound' });
  });

  it('fixes spelling mistakes and shorthand', () => {
    expect(one('trun lfet')).toEqual({ t: 'turn', dir: 'left', deg: 30 });
    expect(one('pls gear dwn')).toEqual({ t: 'gear', down: true });
    expect(one('gaer up')).toEqual({ t: 'gear', down: false });
    expect(one('thottle 80%')).toEqual({ t: 'throttle', set: 0.8 });
    expect(one('afterburnr')).toEqual({ t: 'throttle', set: 1 });
    expect(one('hedding 090')).toEqual({ t: 'heading', deg: 90 });
    expect(one('turn rite 45')).toEqual({ t: 'turn', dir: 'right', deg: 45 });
    expect(one('lnad the plane')).toEqual({ t: 'autoland' });
    expect(one('fier missle')).toEqual({ t: 'fire' });
    expect(one('GEARRRR UPPPP!!!')).toEqual({ t: 'gear', down: false });
    expect(one('take of')).toEqual({ t: 'autotakeoff' });
    expect(one('opne the mpa')).toEqual({ t: 'map' });
    expect(one('opne the setings pls')).toEqual({ t: 'settings' });
  });

  it('splits words typed together', () => {
    expect(one('gearup')).toEqual({ t: 'gear', down: false });
    expect(one('turnright')).toEqual({ t: 'turn', dir: 'right', deg: 30 });
  });

  it('understands numbers written every way', () => {
    expect(one('clime to 5k ft')).toMatchObject({ t: 'alt' });
    expect((one('climb to 4,000 ft') as { meters: number }).meters).toBeCloseTo(1219.2, 0);
    expect(one('altitude 3000')).toMatchObject({ t: 'alt' });
    expect(one('5000 feet climb')).toMatchObject({ t: 'alt' });
    expect(one('level off at 6000 feet')).toMatchObject({ t: 'alt' });
    expect(one('one eighty')).toEqual({ t: 'turn', dir: 'right', deg: 180 });
    expect(one('fly at 400 knots')).toEqual({ t: 'hold_speed', kt: 400 });
    expect(one('climb to fourty thousend feet')).toMatchObject({ t: 'alt' });
  });

  it('drops filler and politeness', () => {
    expect(one('can you please make the jet go up a bit')).toEqual({ t: 'alt_rel', meters: 600 });
    expect(one('turn on the engine plz')).toEqual({ t: 'start_engines' });
    expect(one('i want to land')).toEqual({ t: 'autoland' });
    expect(understand('ok thanks').clauses).toEqual([]);
  });

  it('maps everyday phrasing and slang', () => {
    expect(one('floor it')).toEqual({ t: 'throttle', set: 1 });
    expect(one('go left')).toEqual({ t: 'turn', dir: 'left', deg: 30 });
    expect(one('hard right')).toEqual({ t: 'turn', dir: 'right', deg: 60 });
    expect(one('30 degrees left')).toEqual({ t: 'turn', dir: 'left', deg: 30 });
    expect(one('turn around')).toEqual({ t: 'turn', dir: 'right', deg: 180 });
    expect(one('evade')).toEqual({ t: 'flares' });
    expect(one('follow me')).toEqual({ t: 'wing', cmd: 'rejoin' });
    expect(one('autopilot on')).toEqual({ t: 'level' });
    expect(one('turn off autopilot')).toEqual({ t: 'ap_off' });
    expect(one('throttle up')).toEqual({ t: 'throttle', delta: 0.2 });
    expect(one('find enemy')).toEqual({ t: 'target' });
    expect(one('first person view')).toEqual({ t: 'camera', view: 'cockpit' });
    expect(one('how high am i')).toEqual({ t: 'report', what: 'altitude' });
    expect(one("where's the enemy")).toEqual({ t: 'report', what: 'enemies' });
    expect(one('stay at this height')).toEqual({ t: 'hold_alt' });
    expect(one('help')).toEqual({ t: 'hint' });
    expect(one('abort')).toEqual({ t: 'ap_off' });
  });

  it('accepts broken word order', () => {
    expect(one('down the gear')).toEqual({ t: 'gear', down: true });
    expect(how('down the gear')).toEqual(['guess']);
  });

  it('never fires on a negation', () => {
    expect(one("don't shoot")).toEqual({ t: 'cease' });
    expect(cmds('do not land').some(c => c.t === 'autoland')).toBe(false);
  });

  it('splits chains on sentences, commas, "and", "then" and typos of them', () => {
    expect(cmds('gear up adn climb to 4000 than turn rigth').map(c => c.t)).toEqual(['gear', 'alt', 'turn']);
    expect(cmds('Gear up. Throttle 80. Turn left.').map(c => c.t)).toEqual(['gear', 'throttle', 'turn']);
    expect(cmds('Specter two, engage my target')).toEqual([{ t: 'wing', cmd: 'engage' }]);
  });

  it('offers suggestions instead of guessing when unsure', () => {
    const u = understand('missiles');
    expect(u.clauses[0].how).toBe('unknown');
    expect(u.clauses[0].suggest).toContain('select radar missiles');
    expect(understand('continue').clauses[0].suggest).toEqual(expect.arrayContaining(['resume', 'continue campaign']));
    const junk = understand('purple monkey dishwasher');
    expect(junk.cmds[0]).toMatchObject({ t: 'unknown' });
    expect(junk.clauses[0].suggest).toEqual([]);
  });
});
