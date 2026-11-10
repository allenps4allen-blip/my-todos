import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Item, PastedImage } from '../types'

const PANE = 'my-panel'
const items = atom({ plugin: 'my-todos', key: 'items' } as const, [] as Item[], { shape: 'items-1' })

const pics = atom({ plugin: 'my-todos', key: 'pics' } as const, [] as PastedImage[], { shape: 'pics-1' })
const picked = atom({ plugin: 'my-todos', key: 'picked' } as const, null as number | null, { shape: 'picked-1' })
const picCount = atom({ plugin: 'my-todos', key: 'picCount' } as const, 0, { shape: 'piccount-1' })
const MAX_PNG = 900_000

const bar = (p: number) => {
  const n = Math.round((Math.min(100, Math.max(0, p)) * 12) / 100)
  return '█'.repeat(n) + '░'.repeat(12 - n)
}
const hue = (p: number) => (p >= 80 ? 'red' : p >= 50 ? 'yellow' : 'green')

// Lifetime cost: starts at 0, then grown by each session's new spend.
const lifetime = async ($: any, sessionCost: number, startedAt: number) => {
  let st = (await $.store.get('life')) as { total: number; start: number; last: number } | undefined
  if (!st) {
    st = { total: 0, start: startedAt, last: 0 }
  }
  const delta = st.start === startedAt ? sessionCost - st.last : sessionCost
  if (delta > 0 || st.start !== startedAt) {
    st = { total: st.total + Math.max(0, delta), start: startedAt, last: sessionCost }
    await $.store.set('life', st)
  }
  return st.total
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'todo', description: 'To-do: /todo add <text>, /todo done <n>, /todo remove <n>, /todo clear' })
    const saved = await $.store.get('items')
    if (Array.isArray(saved)) await update($, items, () => saved as Item[])
    for (const old of ['my-todos', 'tool-calls', 'pasted-images']) await $.ui.close({ id: old })
    void $.ui.open({ id: PANE, title: 'Dashboard' })
    $.clock.every(5000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    for (const pic of (e.attachments ?? []).filter(a => a.type === 'image')) {
      const n = await update($, picCount, c => c + 1)
      let png: string | undefined
      try {
        const media = pic.id ? await $.prompt.media({ id: pic.id }) : undefined
        if (media && media.type === 'image' && media.mediaType === 'image/png' && media.base64.length <= MAX_PNG) png = media.base64
      } catch {}
      const entry: PastedImage = { n, prompt: e.text.replace(/\s+/g, ' ').trim().slice(0, 60), name: pic.filename ?? `image ${n}`, mediaType: pic.mediaType ?? 'image', png }
      await update($, pics, l => [entry, ...l].slice(0, 8))
      await update($, picked, () => n)
    }
    return next(e)
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/)
    const n = Number(rest[0]) - 1
    let msg = 'Use: /todo add <text>, /todo done <n>, /todo remove <n>, /todo clear'
    if (verb === 'add' && rest.length) {
      await update($, items, l => [...l, { text: rest.join(' '), done: false }])
      msg = 'Added.'
    } else if (verb === 'done') {
      await update($, items, l => l.map((x, i) => (i === n ? { ...x, done: !x.done } : x)))
      msg = 'Updated.'
    } else if (verb === 'remove') {
      await update($, items, l => l.filter((_, i) => i !== n))
      msg = 'Removed.'
    } else if (verb === 'clear') {
      await update($, items, () => [])
      msg = 'Cleared.'
    }
    await $.store.set('items', await read($, items))
    return { text: msg }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Image } = $.ui.resolve(e)
    const list = await read($, items)
    const imgs = await read($, pics)
    const pick = await read($, picked)
    const shown = imgs.find(i => i.n === pick) ?? imgs[0]
    const room = Math.max(8, (e.viewport?.rows ?? 24) - 4)
    const u = await $.session.usage()
    const model = await $.session.model()
    const ctx = Math.round(u.context.percent ?? 0)
    const five = u.rateLimits.find(r => r.kind === 'five_hour')
    const week = u.rateLimits.find(r => r.kind === 'seven_day')
    const row = (label: string, p: number, extra = '') => (
      <Text>
        <Text dimColor>{label.padEnd(8)}</Text>
        <Text color={hue(p)}>{bar(p)}</Text> {Math.round(p)}%{extra}
      </Text>
    )
    const active = (await $.fs.list('~/.claude/sessions').catch(() => [])).filter((f: any) => String(f.name ?? f).endsWith('.json')).length
    const total = u.cost ? await lifetime($, u.cost.usd, u.startedAt) : undefined
    return (
      <Box flexDirection="row" width="100%" borderStyle="single" borderColor="red" paddingX={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="yellow">To-do</Text>
        {list.length === 0 && <Text dimColor>Nothing yet. /todo add ...</Text>}
        {list.map((x, i) => (
          <Text dimColor={x.done}>{i + 1}. {x.done ? '✓' : '○'} {x.text}</Text>
        ))}
        <Text> </Text>
        <Text bold color="yellow">Active sessions</Text>
        <Text>{active} running</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="yellow">Limits</Text>
        {row('context', ctx)}
        {five && row('5h', five.percentUsed)}
        {week && row('week', week.percentUsed)}
        <Text> </Text>
        <Text>{model}</Text>
        {u.cost && <Text dimColor>session ${u.cost.usd.toFixed(2)}</Text>}
        {total !== undefined && <Text>lifetime ${total.toFixed(2)}</Text>}
      </Box>
      <Box flexDirection="column" width={48} marginLeft={2}>
        <Text bold color="yellow">{`Images (${imgs.length})`}</Text>
        {imgs.length === 0 && <Text dimColor>Paste an image with a prompt.</Text>}
        {imgs.slice(0, 4).map(i => (
          <Button key={`row-${i.n}`} onPress={() => update($, picked, () => i.n)}>
            <Text bold={shown?.n === i.n}>{`${shown?.n === i.n ? '›' : ' '} #${i.n} `}</Text>
            <Text dimColor wrap="truncate-end">{i.prompt || i.name}</Text>
          </Button>
        ))}
        {shown?.png && <Image key="preview" source={{ png: shown.png }} columns={46} rows={Math.min(20, room)} alt={shown.name} />}
        {shown && !shown.png && <Text dimColor>{`${shown.name}, no preview`}</Text>}
      </Box>
      </Box>
    )
  })
}
