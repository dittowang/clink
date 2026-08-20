/** Every user-facing string lives here. English default, Simplified Chinese included. */
export type Locale = 'en' | 'zh-CN'

const TABLE = {
  title:            { en: 'Clink', 'zh-CN': 'Clink 碰杯' },
  tapToStart:       { en: 'Tap to start', 'zh-CN': '点击开始' },
  play:             { en: 'Play', 'zh-CN': '开始游戏' },
  endless:          { en: 'Endless', 'zh-CN': '无尽模式' },
  chapters:         { en: 'Chapters', 'zh-CN': '章节' },
  chapter1:         { en: 'Morning', 'zh-CN': '清晨' },
  chapter2:         { en: 'Noon', 'zh-CN': '正午' },
  chapter3:         { en: 'Golden Hour', 'zh-CN': '黄金时刻' },
  chapter4:         { en: 'Night', 'zh-CN': '夜晚' },
  level:            { en: 'Level', 'zh-CN': '关卡' },
  score:            { en: 'Score', 'zh-CN': '分数' },
  best:             { en: 'Best', 'zh-CN': '最佳' },
  pushes:           { en: 'Pushes', 'zh-CN': '推动次数' },
  pushesLeft:       { en: '{n} left', 'zh-CN': '剩余 {n}' },
  next:             { en: 'Next', 'zh-CN': '下一个' },
  chain:            { en: 'Chain ×{n}', 'zh-CN': '连锁 ×{n}' },
  goalMakeTier:     { en: 'Make a {tier}', 'zh-CN': '合成{tier}' },
  goalScore:        { en: 'Score {n}', 'zh-CN': '达到 {n} 分' },
  goalScoreIn:      { en: 'Score {n} in {m} pushes', 'zh-CN': '{m} 次推动内达到 {n} 分' },
  goalSurvive:      { en: 'Survive {n} pushes', 'zh-CN': '坚持 {n} 次推动' },
  levelComplete:    { en: 'Level Complete!', 'zh-CN': '关卡完成！' },
  gameOver:         { en: 'Over the Line', 'zh-CN': '越线了' },
  gameOverEndless:  { en: 'Run Over', 'zh-CN': '本局结束' },
  newBest:          { en: 'New Best!', 'zh-CN': '新纪录！' },
  retry:            { en: 'Retry', 'zh-CN': '重试' },
  nextLevel:        { en: 'Next Level', 'zh-CN': '下一关' },
  menu:             { en: 'Menu', 'zh-CN': '菜单' },
  resume:           { en: 'Resume', 'zh-CN': '继续' },
  restart:          { en: 'Restart', 'zh-CN': '重新开始' },
  quit:             { en: 'Quit to Menu', 'zh-CN': '退出到菜单' },
  paused:           { en: 'Paused', 'zh-CN': '已暂停' },
  sound:            { en: 'Sound', 'zh-CN': '音效' },
  on:               { en: 'On', 'zh-CN': '开' },
  off:              { en: 'Off', 'zh-CN': '关' },
  language:         { en: 'Language', 'zh-CN': '语言' },
  starsToUnlock:    { en: '{n} ★ to unlock', 'zh-CN': '需要 {n} ★ 解锁' },
  foulWarn:         { en: 'Over the line!', 'zh-CN': '越线警告！' },
  lostToSand:       { en: 'Lost to the sand', 'zh-CN': '掉进沙子里了' },
  leaderboard:      { en: 'Local Best', 'zh-CN': '本地最佳' },
  windWarn:         { en: 'Windy!', 'zh-CN': '起风了！' },
  // tier names
  tier1:  { en: 'Juice Box', 'zh-CN': '果汁盒' },
  tier2:  { en: 'Slim Can', 'zh-CN': '细罐苏打' },
  tier3:  { en: 'Cola Can', 'zh-CN': '可乐罐' },
  tier4:  { en: 'Soda Bottle', 'zh-CN': '汽水瓶' },
  tier5:  { en: 'Highball', 'zh-CN': '橙汁杯' },
  tier6:  { en: 'Mason Jar', 'zh-CN': '梅森罐柠檬水' },
  tier7:  { en: 'Coconut', 'zh-CN': '椰子' },
  tier8:  { en: 'Pineapple Cup', 'zh-CN': '菠萝杯' },
  tier9:  { en: 'Iced Tea Pitcher', 'zh-CN': '冰茶壶' },
  tier10: { en: 'Watermelon Keg', 'zh-CN': '西瓜桶' },
  tier11: { en: 'Ice Bucket', 'zh-CN': '冰桶' },
  tier12: { en: 'Drink Dispenser', 'zh-CN': '饮料机' },
} as const

export type StringKey = keyof typeof TABLE

let locale: Locale = 'en'

export function setLocale(l: Locale): void { locale = l }
export function getLocale(): Locale { return locale }

export function detectLocale(): Locale {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) return 'zh-CN'
  return 'en'
}

/** t('pushesLeft', { n: 5 }) -> "5 left" */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  let s: string = TABLE[key][locale] ?? TABLE[key].en
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  return s
}

export function tierName(id: number): string {
  return t(`tier${id}` as StringKey)
}
