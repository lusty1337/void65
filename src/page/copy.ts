import { ROWS } from '../keyboard/layoutData.mjs';

/** число клавиш считаем по раскладке, а не пишем цифрой */
export const KEY_COUNT = (ROWS as { length: number }[]).reduce((n, row) => n + row.length, 0);

export const HERO = {
  eyebrow: `65% · hot-swap · CNC aluminium`,
  lead: 'Seven layers, one keystroke. Run the cursor over the keys, then scroll to take it apart.',
  // то же для пальца: приглашение поводить курсором - единственная фраза
  // на первом экране, и на телефоне она предлагает невозможное
  leadTouch: 'Seven layers, one keystroke. Scroll to take the whole build apart, piece by piece.',
  hint: 'Scroll to disassemble',
  specs: [`${KEY_COUNT} keys`, '6063-T5', 'QMK / VIA'],
};

// слои сверху вниз, в том порядке, в каком их снимают с собранной платы:
// по нему же идёт разборка в сцене
export const LAYERS = [
  { name: 'Keycaps', spec: 'PBT 1.5 mm', note: 'Double-shot, so the legend is moulded through the cap and cannot wear off.' },
  { name: 'Plate', spec: 'Steel 1.5 mm', note: 'Sets the stiffness of the stroke and how hard it bounces at the bottom.' },
  { name: 'Switches', spec: '68 sockets', note: 'Hot-swap. A switch changes in seconds, with no soldering iron.' },
  { name: 'Stabilizers', spec: '6 units', note: 'Lubed and clipped under the long keys. No rattle, no rocking.' },
  { name: 'Foam', spec: 'Silicone 2.5 mm', note: 'Kills resonance in the case and drops the pitch of every press.' },
  { name: 'PCB', spec: 'Hot-swap · QMK', note: 'Every key remaps to whatever the hand wants, no firmware build.' },
  { name: 'Bottom case', spec: 'Milled 6063-T5', note: 'The base the whole build sits on, and what absorbs its resonance.' },
];

// цифры от убранного экрана со свитчами: тот разрывал непрерывную сцену
// на "до" и "после" и заставлял камеру нырять в макро там, где рассказ
// уже кончился. сами характеристики переехали туда, где их читают
export const ORDER = {
  eyebrow: 'Edition 001',
  note: 'Built to order. Ships spring 2026.',
  cta: 'Reserve a build',
  specs: [
    ['Switch', 'Pulse Bump · tactile'],
    ['Actuation', '55 g · 2.2 mm'],
    ['Layout', `65% · ${KEY_COUNT} keys`],
    ['Firmware', 'QMK / VIA'],
  ] as [string, string][],
};
