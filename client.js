// dsh-image-gen client half: render tool-generated images as inline clickable
// thumbnails in the conversation flow.
//
// Mechanism (mirrors dsh-tool-vision): register a custom Conversation Node that
// matches `tool/result` events carrying image attachments, then register a
// 'conversation.chat.node' renderer for that node kind. The renderer receives the
// conversation owner props (including `loadImage`), so it can load durable image
// bytes and hand them to the official ImageGallery (thumbnail + click-to-lightbox).
window.__ModuleLoader__.load({
  id: 'dsh-image-gen',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement
    var uiAttachment = require('@deepseek-ai/dsh-client-ui-attachment')
    var ImageGallery = uiAttachment.ImageGallery

    // Minimal locale strings for the gallery / lightbox (product copy: Chinese).
    var LABELS = {
      image: '图片',
      open: '查看原图',
      openNamed: function (label) { return '查看图片 ' + label },
      loading: '加载中…',
      loadFailed: '加载失败，点击重试',
      lightbox: { dialog: '图片预览', close: '关闭' },
    }

    // Extract durable image attachment refs from one tool/result event, if any.
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

    // Inline thumbnail gallery for one tool-result image node.
    function ImageThumbNode(props) {
      var node = props.node
      var attachments = (node && node.data && node.data.attachments) || []
      var load = props.loadImage
      if (attachments.length === 0 || typeof load !== 'function') return null
      return h(ImageGallery, { images: attachments, load: load, align: 'start', labels: LABELS })
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
