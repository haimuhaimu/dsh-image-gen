// dsh-image-gen client half: render tool-generated images as inline clickable
// thumbnails in the conversation flow.
//
// Mechanism (mirrors dsh-tool-vision): register a custom Conversation Node that
// matches `tool/result` events carrying image attachments, then register a
// 'conversation.chat.node' renderer for that node kind. The renderer receives the
// conversation owner props (including `loadImage`), so it can load durable image
// bytes and draw thumbnails. If the official ImageGallery is requirable we use it
// (thumbnail + lightbox); otherwise we fall back to a self-drawn inline thumbnail
// that opens the original on click, so the feature never silently no-ops.
window.__ModuleLoader__.load({
  id: 'dsh-image-gen',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    // Optional: the official gallery. Some builds don't hand it to third-party
    // plugins; absence must not break us.
    var UI = null
    try { UI = require('@deepseek-ai/dsh-client-ui-attachment') } catch (e) { UI = null }

    var LABELS = {
      image: '图片',
      open: '查看原图',
      openNamed: function (label) { return '查看图片 ' + label },
      loading: '加载中…',
      loadFailed: '加载失败，点击重试',
      lightbox: { dialog: '图片预览', close: '关闭' },
    }

    function attachmentsOf(event) {
      if (!event || event.type !== 'tool/result') return []
      var message = event.data && event.data.message
      var first = message && message.content && message.content[0]
      var content = first && first.content
      if (!Array.isArray(content)) return []
      var out = []
      for (var i = 0; i < content.length; i++) {
        var block = content[i]
        if (block && block.type === 'image' && block.attachment) out.push({ attachment: block.attachment })
      }
      return out
    }

    var imageThumbDefinition = {
      kind: 'image-gen-thumb',
      target: 'chat',
      match: function (event) {
        if (attachmentsOf(event).length === 0) return null
        var callId = String(event.data.message.source.callId)
        return { id: callId, role: 'start' }
      },
      start: function (_context, match) {
        return { attachments: attachmentsOf(match.event) }
      },
      update: function (context) { return context.state },
      publication: function () { return 'immediate' },
      buildLocationData: function () { return null },
      buildViewNode: function (context) {
        if (context.state === undefined || context.state.attachments.length === 0) return null
        return {
          key: context.key,
          kind: 'image-gen-thumb',
          id: context.id,
          target: 'chat',
          anchorSeq: context.start ? context.start.event.seq : 0,
          location: (context.start && context.start.location) || { kind: 'unresolved' },
          visibility: 'visible',
          data: { attachments: context.state.attachments },
        }
      },
    }

    // Self-drawn thumbnail: loads its own src via props.loadImage, opens the
    // original in a new tab on click. Used when ImageGallery is unavailable.
    function FallbackThumb(props) {
      var attachment = props.attachment
      var load = props.load
      var st = React.useState(null)
      var src = st[0]; var setSrc = st[1]
      var err = React.useState(false)
      var failed = err[0]; var setFailed = err[1]
      React.useEffect(function () {
        var alive = true
        if (typeof load !== 'function') return
        load(attachment).then(function (url) { if (alive) setSrc(url) })
          .catch(function () { if (alive) setFailed(true) })
        return function () { alive = false }
      }, [attachment, load])
      if (failed) return null
      if (src === null) {
        return h('span', { style: { display: 'inline-block', width: 96, height: 96, borderRadius: 8, background: 'rgba(127,127,127,.15)' } })
      }
      return h('img', {
        src: src,
        alt: attachment.name || 'image',
        title: '查看原图',
        onClick: function () { try { window.open(src, '_blank') } catch (e) {} },
        style: {
          width: 'auto', height: 'auto', maxWidth: 240, maxHeight: 240,
          borderRadius: 8, cursor: 'zoom-in', display: 'block', objectFit: 'contain',
        },
      })
    }

    function ImageThumbNode(props) {
      var node = props.node
      var attachments = (node && node.data && node.data.attachments) || []
      var load = props.loadImage
      if (attachments.length === 0 || typeof load !== 'function') return null
      if (UI && UI.ImageGallery) {
        return h(UI.ImageGallery, { images: attachments, load: load, align: 'start', labels: LABELS })
      }
      return h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', padding: '4px 0' } },
        attachments.map(function (a, i) {
          return h(FallbackThumb, { key: (a.attachment.attachmentId || i) + ':' + i, attachment: a.attachment, load: load })
        }))
    }

    function apply(ctx) {
      if (ctx.conversationEvents && typeof ctx.conversationEvents.register === 'function') {
        ctx.conversationEvents.register(imageThumbDefinition)
      }
      if (ctx.slots && typeof ctx.slots.inject === 'function') {
        ctx.slots.inject('conversation.chat.node', function () {
          return ctx.slots.register(
            { name: 'conversation.chat.node', key: 'image-gen-thumb' },
            ImageThumbNode,
          )
        })
      }
    }

    exports.apply = apply
    exports.inject = ['slots', 'conversationEvents']
    return module.exports
  },
})
