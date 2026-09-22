import { ROWS } from '../keyboard/layoutData.mjs';
import type { SwitchType } from '../keyboard/types';

/** число клавиш считаем по раскладке, а не пишем цифрой */
export const KEY_COUNT = (ROWS as { length: number }[]).reduce((n, row) => n + row.length, 0);

export const HERO = {
  eyebrow: `65% · hot-swap · CNC aluminium`,
  lead: 'Seven layers, one keystroke. Type on it, run the cursor over the keys, then scroll to take it apart.',
  // то же для пальца: на телефоне нет ни курсора, ни клавиатуры,
  // и приглашение к ним предлагало бы невозможное
  leadTouch: 'Seven layers, one keystroke. Tap the keys, then scroll to take the whole build apart.',
  hint: 'Scroll to disassemble',
  /** подпись над выбором свитча - он стоит здесь же, на первом экране */
  switchLabel: 'Switch',
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
// три свитча сборки. цвет штока и подсветки под каждый лежит там же,
// где остальная палитра предмета, - materials.ts, SWITCH_TINT
export const SWITCHES: { id: SwitchType; name: string; kind: string; force: string }[] = [
  { id: 'linear', name: 'Glide Line', kind: 'linear', force: '45 g · 2.0 mm' },
  { id: 'tactile', name: 'Pulse Bump', kind: 'tactile', force: '55 g · 2.2 mm' },
  { id: 'clicky', name: 'Snap Click', kind: 'clicky', force: '60 g · 2.4 mm' },
];

export const ORDER = {
  eyebrow: 'Edition 001',
  note: 'Built to order. Ships spring 2026.',
  cta: 'Reserve a build',
  // список читает выбор, сделанный на первом экране: сам свитч, усилие
  // и ход. иначе выбирать было бы нечего - характеристики стояли бы
  // теми же, что и до него
  specs: (sw: (typeof SWITCHES)[number]): [string, string][] => [
    ['Switch', `${sw.name} · ${sw.kind}`],
    ['Actuation', sw.force],
    ['Layout', `65% · ${KEY_COUNT} keys`],
    ['Firmware', 'QMK / VIA'],
  ],
};
