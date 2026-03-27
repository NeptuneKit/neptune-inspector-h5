import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { normalizeBaseUrl } from '../api'
import { decodeClientKey } from '../features/clients/clientKey'
import { canonicalFontWeight } from '../features/views/typography'
import { fetchMockViewSnapshot, fetchViewSnapshot, type MockPlatform } from '../features/views/viewService'
import { safeStorageGet } from '../storage'
import type { ViewTreeNode, ViewTreeSnapshot } from '../types'
import { BASE_URL_STORAGE_KEY, DEFAULT_BASE_URL } from '../shared/constants'

type ViewRenderMode = '2d' | '3d'
type ViewIdentity = ReturnType<typeof decodeClientKey>

interface ViewInfoPageProps {
  mockOnly?: boolean
  mockPlatform?: MockPlatform
  replayMode?: boolean
}

interface FlattenedViewNode {
  id: string
  parentId: string | null
  name: string
  frame?: ViewTreeNode['frame']
  style?: ViewTreeNode['style']
  attributes?: ViewTreeNode['attributes']
  text?: string | null
  visible?: boolean
  depth: number
  order: number
  siblingCount: number
  keyPath: string
}

interface ViewScene {
  nodes: FlattenedViewNode[]
  bounds: {
    minX: number
    minY: number
    width: number
    height: number
    viewportWidth: number
    viewportHeight: number
  } | null
}

type NodeRelation = 'selected' | 'ancestor' | 'descendant' | 'none'
type DeviceViewport = { width: number; height: number }

interface PositionedNode {
  node: FlattenedViewNode
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  renderOrder: number
}

interface ViewEdge {
  id: string
  fromKey: string
  toKey: string
  x1: number
  y1: number
  x2: number
  y2: number
  relation: NodeRelation
}

type RenderPlatform = 'harmony' | 'ios' | 'android' | 'web' | 'mock'

const REPLAY_DEVICE_VIEWPORTS: Record<MockPlatform, DeviceViewport> = {
  // Match current real screenshot baselines for visual regression.
  ios: { width: 1206, height: 2622 },
  android: { width: 1080, height: 2400 },
  harmony: { width: 1320, height: 2856 },
}

const delay = (ms: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, ms)
})

function relationOfNode(nodeKey: string, selectedNodeKey: string | null): NodeRelation {
  if (!selectedNodeKey) {
    return 'none'
  }
  if (nodeKey === selectedNodeKey) {
    return 'selected'
  }
  if (selectedNodeKey.startsWith(`${nodeKey}.`)) {
    return 'ancestor'
  }
  if (nodeKey.startsWith(`${selectedNodeKey}.`)) {
    return 'descendant'
  }
  return 'none'
}

function parentKeyOf(nodeKey: string): string | null {
  const separator = nodeKey.lastIndexOf('.')
  if (separator <= 0) {
    return null
  }
  return nodeKey.slice(0, separator)
}

function createPositionedNodes(
  nodes: FlattenedViewNode[],
  scene: ViewScene,
  fallback: { xByDepth: number; yByOrder: number },
): PositionedNode[] {
  return nodes.map((node) => {
    const x = node.frame && scene.bounds ? node.frame.x - scene.bounds.minX : 24 + node.depth * fallback.xByDepth
    const y = node.frame && scene.bounds ? node.frame.y - scene.bounds.minY : 24 + node.order * fallback.yByOrder
    const width = node.frame ? Math.max(1, node.frame.width) : 160
    const height = node.frame ? Math.max(1, node.frame.height) : 56
    const zIndex = node.style?.zIndex ?? 0
    // Keep platform zIndex semantics, but ensure deeper descendants render above ancestors
    // when they share the same zIndex value.
    const renderOrder = zIndex * 10000 + node.depth * 100 + node.order
    return {
      node,
      x,
      y,
      width,
      height,
      zIndex,
      renderOrder,
    }
  })
}

function createViewEdges(positionedNodes: PositionedNode[], selectedNodeKey: string | null): ViewEdge[] {
  const positionedMap = new Map(positionedNodes.map((item) => [item.node.keyPath, item] as const))
  const output: ViewEdge[] = []
  for (const item of positionedNodes) {
    const parentKey = parentKeyOf(item.node.keyPath)
    if (!parentKey) {
      continue
    }
    const parent = positionedMap.get(parentKey)
    if (!parent) {
      continue
    }
    output.push({
      id: `${parent.node.keyPath}->${item.node.keyPath}`,
      fromKey: parent.node.keyPath,
      toKey: item.node.keyPath,
      x1: parent.x + parent.width / 2,
      y1: parent.y + parent.height / 2,
      x2: item.x + item.width / 2,
      y2: item.y + item.height / 2,
      relation: relationOfNode(item.node.keyPath, selectedNodeKey),
    })
  }
  return output
}

function flyToNode(nodeKey: string | null): void {
  if (!nodeKey) {
    return
  }
  const target = document.querySelector(`[data-node-key="${nodeKey}"]`)
  if (!(target instanceof HTMLElement)) {
    return
  }

  const container = target.closest('.view-graph-3d-wrap, .view-graph')
  if (container instanceof HTMLElement && typeof container.scrollTo === 'function') {
    const targetRect = target.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const nextLeft = container.scrollLeft + (targetRect.left - containerRect.left) - (container.clientWidth - targetRect.width) / 2
    const nextTop = container.scrollTop + (targetRect.top - containerRect.top) - (container.clientHeight - targetRect.height) / 2
    container.scrollTo({
      left: Math.max(0, nextLeft),
      top: Math.max(0, nextTop),
      behavior: 'smooth',
    })
    return
  }

  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  }
}

function useFitScale(
  containerRef: RefObject<HTMLElement | null>,
  contentWidth: number,
  contentHeight: number,
  allowUpscale = false,
): number {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      setScale(1)
      return
    }

    const updateScale = (): void => {
      const availableWidth = Math.max(1, container.clientWidth - 24)
      const availableHeight = Math.max(1, container.clientHeight - 24)
      const widthScale = availableWidth / Math.max(1, contentWidth)
      const heightScale = availableHeight / Math.max(1, contentHeight)
      const fitScale = Math.min(widthScale, heightScale)
      const maxScale = allowUpscale ? 8 : 1
      const nextScale = Math.max(0.35, Math.min(maxScale, fitScale))
      setScale(Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1)
    }

    updateScale()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateScale())
      observer.observe(container)
      return () => observer.disconnect()
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateScale)
      return () => window.removeEventListener('resize', updateScale)
    }
  }, [allowUpscale, containerRef, contentWidth, contentHeight])

  return scale
}

function toPixelLength(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined
  }
  return `${String(value)}px`
}

function parseHexAlpha(color: string | undefined): number | null {
  if (!color) {
    return null
  }
  const normalized = color.trim()
  if (!normalized.startsWith('#')) {
    return null
  }
  const raw = normalized.slice(1)
  if (raw.length === 8) {
    const alpha = Number.parseInt(raw.slice(6, 8), 16)
    return Number.isFinite(alpha) ? alpha / 255 : null
  }
  if (raw.length === 4) {
    const alpha = Number.parseInt(raw.slice(3, 4).repeat(2), 16)
    return Number.isFinite(alpha) ? alpha / 255 : null
  }
  return 1
}

function hasVisibleVisualStyle(style: ViewTreeNode['style'] | undefined): boolean {
  if (!style) {
    return false
  }
  const opacity = style.opacity
  if (opacity !== undefined && opacity <= 0) {
    return false
  }
  const bgAlpha = parseHexAlpha(style.backgroundColor)
  if (style.backgroundColor && (bgAlpha === null || bgAlpha > 0)) {
    return true
  }
  const borderAlpha = parseHexAlpha(style.borderColor)
  if ((style.borderWidth ?? 0) > 0 && style.borderColor && (borderAlpha === null || borderAlpha > 0)) {
    return true
  }
  return false
}

function hasRenderableText(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.trim().length > 0
}

function isPlatformNoiseNode(node: FlattenedViewNode, platform: RenderPlatform): boolean {
  if (platform === 'ios') {
    if (node.name === '_UIScrollViewScrollIndicator') {
      return true
    }
    if (node.name === '_UIPointerInteractionAssistantEffectContainerView') {
      return true
    }
  }
  return false
}

function isVisuallyRenderableNode(node: FlattenedViewNode, platform: RenderPlatform): boolean {
  if (isPlatformNoiseNode(node, platform)) {
    return false
  }
  if (node.visible === false) {
    return false
  }
  const frame = node.frame
  if (!frame || frame.width <= 0 || frame.height <= 0) {
    return false
  }
  if (hasRenderableText(node.text) || hasVisibleVisualStyle(node.style)) {
    return true
  }
  if (
    platform === 'ios' &&
    node.name.startsWith('_') &&
    !hasRenderableText(node.text) &&
    !hasVisibleVisualStyle(node.style)
  ) {
    return false
  }
  // Keep top-level containers as structural anchors for viewport restoration.
  if (node.depth <= 1) {
    return true
  }
  return false
}

function createTypographyStyle(style: ViewTreeNode['style'] | undefined, platform: RenderPlatform): CSSProperties {
  const rawAlign = style?.textAlign?.toLowerCase().trim()
  const mappedAlign =
    rawAlign === undefined || rawAlign === ''
      ? undefined
      : rawAlign.includes('center')
        ? 'center'
        : rawAlign.includes('end') || rawAlign.includes('right')
          ? 'right'
          : rawAlign.includes('justify')
            ? 'justify'
            : 'left'
  const fallbackLineHeight =
    style?.lineHeight !== undefined && Number.isFinite(style.lineHeight) && style.lineHeight > 0
      ? toPixelLength(style.lineHeight)
      : undefined
  const fontFamily =
    style?.fontFamily && style.fontFamily.trim().length > 0
      ? style.fontFamily
      : platform === 'harmony'
        ? 'HarmonyOS Sans, PingFang SC, sans-serif'
        : undefined
  return {
    fontSize: toPixelLength(style?.fontSize),
    lineHeight: fallbackLineHeight,
    letterSpacing: toPixelLength(style?.letterSpacing),
    fontWeight: canonicalFontWeight(style),
    fontFamily,
    textAlign: mappedAlign,
    color: style?.textColor,
  }
}

function mapTextContentAlign(style: ViewTreeNode['style'] | undefined): CSSProperties['alignItems'] {
  const raw = style?.textContentAlign?.toLowerCase().trim()
  if (!raw) {
    return 'center'
  }
  if (raw.includes('top') || raw.includes('start')) {
    return 'flex-start'
  }
  if (raw.includes('bottom') || raw.includes('end')) {
    return 'flex-end'
  }
  return 'center'
}

function shouldRenderSingleLineText(
  style: ViewTreeNode['style'] | undefined,
  frameHeight: number,
  text: string,
): boolean {
  if (text.includes('\n')) {
    return false
  }
  const fontSize = style?.fontSize
  if (fontSize === undefined || !Number.isFinite(fontSize) || fontSize <= 0) {
    return false
  }
  // ArkUI text nodes with near-font-size frame height are visually single-line.
  return frameHeight > 0 && frameHeight <= fontSize * 1.6
}

function normalizePlatformColor(color: string | undefined, platform: RenderPlatform): string | undefined {
  if (!color || !color.startsWith('#')) {
    return color
  }
  const hex = color.slice(1)
  if (hex.length !== 8) {
    return color
  }
  // Standardized snapshot colors are normalized to #RRGGBBAA by the gateway.
  // Keep them as-is to avoid channel-swapping on iOS/Android.
  return color
}

function normalizeRenderStyle(
  style: ViewTreeNode['style'] | undefined,
  platform: RenderPlatform,
): ViewTreeNode['style'] | undefined {
  if (!style) {
    return undefined
  }
  return {
    ...style,
    backgroundColor: normalizePlatformColor(style.backgroundColor, platform),
    borderColor: normalizePlatformColor(style.borderColor, platform),
    textColor: normalizePlatformColor(style.textColor, platform),
  }
}

function applyPlatformRenderFallback(
  style: ViewTreeNode['style'] | undefined,
  node: FlattenedViewNode,
  frameHeight: number,
  platform: RenderPlatform,
): ViewTreeNode['style'] | undefined {
  if (!style) {
    return style
  }
  if (platform !== 'harmony') {
    if (platform === 'ios' && node.name === 'UIWindow') {
      return {
        ...style,
        backgroundColor: '#00000000',
      }
    }
    return style
  }

  let changed = false
  let borderRadius = style.borderRadius
  let textAlign = style.textAlign
  const normalizedAlign = textAlign?.toLowerCase().trim() ?? ''

  if (node.name === 'Button') {
    if ((borderRadius ?? 0) <= 0 && frameHeight > 0) {
      borderRadius = frameHeight / 2
      changed = true
    }
    if (!textAlign) {
      textAlign = 'Alignment.Center'
      changed = true
    }
  } else if (node.name === 'Text') {
    const hasBackground = typeof style.backgroundColor === 'string' && style.backgroundColor.toUpperCase() !== '#00000000'
    const isPill = (borderRadius ?? 0) > 0
    const isStartAligned = normalizedAlign.includes('start') || normalizedAlign === 'left'
    if (hasBackground && isPill && (textAlign === undefined || isStartAligned)) {
      textAlign = 'Alignment.Center'
      changed = true
    }
  }

  if (!changed) {
    return style
  }

  return {
    ...style,
    borderRadius,
    textAlign,
  }
}

function PropertySection({ title, children, defaultOpen = true }: { title: string, children: ReactNode, defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="prop-section">
      <div className="prop-section-header" onClick={() => setOpen(!open)}>
        <span style={{ fontSize: '8px', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s', width: '10px' }}>▼</span>
        <span className="prop-section-title">{title}</span>
      </div>
      {open && <div className="prop-section-content">{children}</div>}
    </div>
  )
}

function PropertyRow({ label, value, highlight = false }: { label: string, value: ReactNode, highlight?: boolean }) {
  return (
    <div className="prop-row">
      <span className="prop-key">{label}</span>
      <span className={`prop-val ${highlight ? 'prop-val-highlight' : ''}`}>{value}</span>
    </div>
  )
}

function ViewTreeNodeItem({
  node,
  path,
  selectedNodeKey,
  onSelect,
}: {
  node: ViewTreeNode
  path: string
  selectedNodeKey: string | null
  onSelect: (nodeKey: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const hasChildren = node.children.length > 0
  const relation = relationOfNode(path, selectedNodeKey)

  return (
    <li>
      <div className={`view-tree-row relation-${relation}`} style={{ padding: '0.15rem 0.25rem' }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed(!collapsed)
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              padding: '0 2px',
              cursor: 'pointer',
              fontSize: '8px',
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
              width: '14px',
              display: 'flex',
              justifyContent: 'center'
            }}
          >
            ▼
          </button>
        ) : (
          <div style={{ width: '14px' }} />
        )}
        <button
          type="button"
          onClick={() => onSelect(path)}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            textAlign: 'left',
            cursor: 'pointer',
            padding: '2px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            overflow: 'hidden'
          }}
        >
          <span className="view-tree-name" style={{ 
            fontSize: '0.75rem', 
            color: relation === 'selected' ? 'var(--accent-blue)' : 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {node.name}
          </span>
        </button>
      </div>
      {hasChildren && !collapsed ? (
        <ul className="view-tree-list">
          {node.children.map((child, index) => (
            <ViewTreeNodeItem
              key={`${path}.${String(index)}.${child.id}`}
              node={child}
              path={`${path}.${String(index)}`}
              selectedNodeKey={selectedNodeKey}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function flattenViewTree(roots: ViewTreeNode[]): FlattenedViewNode[] {
  const output: FlattenedViewNode[] = []
  let order = 0

  const walk = (node: ViewTreeNode, depth: number, keyPath: string, siblingCount: number): void => {
    output.push({
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      frame: node.frame,
      style: node.style,
      attributes: node.attributes,
      text: node.text,
      visible: node.visible,
      depth,
      order,
      siblingCount,
      keyPath,
    })
    order += 1
    node.children.forEach((child, index) => {
      walk(child, depth + 1, `${keyPath}.${String(index)}`, node.children.length)
    })
  }

  roots.forEach((root, index) => {
    walk(root, 0, `root.${String(index)}`, roots.length)
  })
  return output
}

function shouldParticipateInSceneBounds(node: FlattenedViewNode, platform: RenderPlatform): boolean {
  if (node.depth <= 1) {
    return true
  }
  return isVisuallyRenderableNode(node, platform)
}

function createViewScene(nodes: FlattenedViewNode[], platform: RenderPlatform): ViewScene {
  const visibleNodes = nodes.filter((node) => node.visible !== false)
  const framedNodes = visibleNodes.filter((node) => {
    if (node.frame === undefined || node.frame.width <= 0 || node.frame.height <= 0) {
      return false
    }
    return shouldParticipateInSceneBounds(node, platform)
  })
  if (framedNodes.length === 0) {
    return { nodes: visibleNodes, bounds: null }
  }

  const rootFramedNodes = framedNodes.filter((node) => node.depth === 0)
  const anchorNode =
    rootFramedNodes.length > 0
      ? rootFramedNodes.reduce((largest, current) => {
          const largestArea = (largest.frame?.width ?? 0) * (largest.frame?.height ?? 0)
          const currentArea = (current.frame?.width ?? 0) * (current.frame?.height ?? 0)
          return currentArea > largestArea ? current : largest
        })
      : framedNodes[0]

  const minX = rootFramedNodes.length > 0
    ? 0
    : (anchorNode.frame?.x ?? Math.min(...framedNodes.map((node) => node.frame?.x ?? 0)))
  const minY = rootFramedNodes.length > 0
    ? 0
    : (anchorNode.frame?.y ?? Math.min(...framedNodes.map((node) => node.frame?.y ?? 0)))
  const anchorWidth = Math.max(1, anchorNode.frame?.width ?? 1)
  const anchorHeight = Math.max(1, anchorNode.frame?.height ?? 1)

  return {
    nodes: visibleNodes,
    bounds: {
      minX,
      minY,
      // Keep viewport at root size, but let stage grow to full content extent so
      // overflowing children can be reached by scrolling inside the view area.
      width: Math.max(
        anchorWidth,
        ...framedNodes.map((node) => {
          const frame = node.frame
          return frame ? frame.x - minX + frame.width : 0
        }),
      ),
      height: Math.max(
        anchorHeight,
        ...framedNodes.map((node) => {
          const frame = node.frame
          return frame ? frame.y - minY + frame.height : 0
        }),
      ),
      viewportWidth: anchorWidth,
      viewportHeight: anchorHeight,
    },
  }
}

function inferStageBackgroundColor(
  positionedNodes: PositionedViewNode[],
  platform: RenderPlatform,
): string | undefined {
  const nonTransparent = (color: string | undefined): string | undefined => {
    const normalized = color?.toUpperCase()
    if (!normalized || normalized === '#00000000' || normalized === '#000000') {
      return undefined
    }
    return normalized
  }

  const rootNodes = positionedNodes.filter((item) => item.node.depth === 0)
  for (const root of rootNodes) {
    const style = applyPlatformRenderFallback(
      normalizeRenderStyle(root.node.style, platform),
      root.node,
      root.height,
      platform,
    )
    const color = nonTransparent(style?.backgroundColor)
    if (color) {
      return color
    }
  }

  const sortedByVisualWeight = [...positionedNodes].sort((left, right) => {
    const areaL = left.width * left.height
    const areaR = right.width * right.height
    if (areaL !== areaR) {
      return areaR - areaL
    }
    return left.node.depth - right.node.depth
  })

  for (const item of sortedByVisualWeight) {
    const style = applyPlatformRenderFallback(
      normalizeRenderStyle(item.node.style, platform),
      item.node,
      item.height,
      platform,
    )
    const color = nonTransparent(style?.backgroundColor)
    if (color) {
      return color
    }
  }
  return undefined
}

function ViewGraph2D({
  nodes,
  selectedNodeKey,
  onSelect,
  showConnections,
  platform,
  allowUpscale,
  captureMode,
  disableAutoFit,
}: {
  nodes: FlattenedViewNode[]
  selectedNodeKey: string | null
  onSelect: (nodeKey: string) => void
  showConnections: boolean
  platform: RenderPlatform
  allowUpscale?: boolean
  captureMode?: boolean
  disableAutoFit?: boolean
}) {
  const scene = useMemo(() => createViewScene(nodes, platform), [nodes, platform])
  const [zoomPercent, setZoomPercent] = useState(100)
  const hasSelection = selectedNodeKey !== null
  const positionedNodes = useMemo(
    () =>
      createPositionedNodes(scene.nodes, scene, { xByDepth: 190, yByOrder: 64 }).sort((left, right) => {
        if (left.renderOrder !== right.renderOrder) {
          return left.renderOrder - right.renderOrder
        }
        return left.node.order - right.node.order
      }),
    [scene.nodes],
  )
  const viewEdges = useMemo(
    () => (showConnections ? createViewEdges(positionedNodes, selectedNodeKey) : []),
    [positionedNodes, selectedNodeKey, showConnections],
  )
  const renderableNodes = useMemo(
    () =>
      positionedNodes.filter((item) => {
        const relation = relationOfNode(item.node.keyPath, selectedNodeKey)
        if (relation !== 'none') {
        return true
      }
      return isVisuallyRenderableNode(item.node, platform)
    }),
    [positionedNodes, selectedNodeKey, platform],
  )
  const sceneWidth = scene.bounds?.width ?? 980
  const sceneHeight = scene.bounds?.height ?? Math.max(640, positionedNodes.length * 60)
  const viewportWidth = scene.bounds?.viewportWidth ?? sceneWidth
  const viewportHeight = scene.bounds?.viewportHeight ?? sceneHeight
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fitScale = useFitScale(containerRef, viewportWidth, viewportHeight, allowUpscale ?? false)
  const baseScale = disableAutoFit ? 1 : fitScale
  const effectiveScale = baseScale * (zoomPercent / 100)
  const scaledWidth = Math.max(1, viewportWidth * effectiveScale)
  const scaledHeight = Math.max(1, viewportHeight * effectiveScale)
  const stageBackgroundColor = useMemo(
    () => inferStageBackgroundColor(positionedNodes, platform),
    [positionedNodes, platform],
  )

  return (
    <div
      className={`view-graph view-graph-2d ${hasSelection ? 'view-selection-active' : ''}`}
      data-testid="view-canvas-2d"
      ref={containerRef}
    >
      {captureMode ? null : (
        <div className="view-zoom-control">
          <button onClick={() => setZoomPercent((value) => Math.max(50, value - 10))}>-</button>
          <span>{zoomPercent}%</span>
          <button onClick={() => setZoomPercent((value) => Math.min(300, value + 10))}>+</button>
        </div>
      )}
      <div className="view-stage-viewport" style={{ width: `${String(scaledWidth)}px`, height: `${String(scaledHeight)}px` }}>
        <div
          className={`view-stage view-stage-scaled ${
            scene.bounds ? (captureMode ? 'view-stage-plain' : 'view-stage-framed') : 'view-stage-fallback'
          }`}
          style={{
            width: `${String(sceneWidth)}px`,
            height: `${String(sceneHeight)}px`,
            transform: `scale(${String(effectiveScale)})`,
            backgroundColor: stageBackgroundColor,
          }}
        >
          {showConnections ? (
            <svg className="view-links-layer" width={sceneWidth} height={sceneHeight} aria-hidden="true">
              {viewEdges.map((edge) => (
                <line
                  key={edge.id}
                  className={`view-link relation-${edge.relation}`}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                />
              ))}
            </svg>
          ) : null}
          {renderableNodes.map((positioned) => {
            const hasFrame = positioned.node.frame !== undefined && scene.bounds !== null
            const relation = relationOfNode(positioned.node.keyPath, selectedNodeKey)
            const showNodeChrome = !hasFrame || relation !== 'none'
            const baseRenderStyle = normalizeRenderStyle(positioned.node.style, platform)
            const renderStyle = applyPlatformRenderFallback(
              baseRenderStyle,
              positioned.node,
              positioned.height,
              platform,
            )
            const typographyStyle = createTypographyStyle(renderStyle, platform)
            const isCenteredButton =
              platform === 'harmony' &&
              positioned.node.name === 'Button' &&
              typographyStyle.textAlign === 'center'
            const isRootWhiteFill =
              captureMode &&
              positioned.node.depth === 0 &&
              (renderStyle?.backgroundColor?.toUpperCase() === '#FFFFFFFF' ||
                renderStyle?.backgroundColor?.toUpperCase() === '#FFFFFF')
            const shouldClipNode = hasFrame && positioned.node.name !== 'Text'
            return (
              <div
                key={positioned.node.keyPath}
                className={`view-node view-node-2d ${hasFrame ? 'view-node-framed' : ''} ${showNodeChrome ? '' : 'view-node-overlay-hidden'} relation-${relation}`}
                data-node-key={positioned.node.keyPath}
                style={{
                  left: `${String(positioned.x)}px`,
                  top: `${String(positioned.y)}px`,
                  width: `${String(positioned.width)}px`,
                  height: `${String(positioned.height)}px`,
                  overflow: shouldClipNode ? 'hidden' : undefined,
                  opacity: renderStyle?.opacity,
                  backgroundColor: isRootWhiteFill ? 'transparent' : renderStyle?.backgroundColor,
                  borderColor: renderStyle?.borderColor,
                  borderWidth: renderStyle?.borderWidth,
                  borderRadius: renderStyle?.borderRadius,
                  color: renderStyle?.textColor,
                  zIndex: positioned.renderOrder,
                  justifyContent: isCenteredButton ? 'center' : undefined,
                  alignItems: isCenteredButton ? 'center' : undefined,
                  paddingTop: toPixelLength(renderStyle?.paddingTop),
                  paddingRight: toPixelLength(renderStyle?.paddingRight),
                  paddingBottom: toPixelLength(renderStyle?.paddingBottom),
                  paddingLeft: toPixelLength(renderStyle?.paddingLeft),
                }}
                onClick={() => onSelect(positioned.node.keyPath)}
              >
                {showNodeChrome ? (
                  <span className="view-node-name">{positioned.node.name}</span>
                ) : null}
                {positioned.node.text ? (
                  (() => {
                    const pillLike =
                      ((renderStyle?.borderRadius ?? 0) > 0 &&
                        !!renderStyle?.backgroundColor &&
                        renderStyle.backgroundColor.toUpperCase() !== '#00000000')
                    const centeredLike = typographyStyle.textAlign === 'center'
                    const singleLine = shouldRenderSingleLineText(renderStyle, positioned.height, positioned.node.text)
                    const singleLineHeight = `${String(positioned.height)}px`
                    const shouldForceSingleLineHeight = singleLine && typographyStyle.lineHeight === undefined
                    const contentAlignItems = isCenteredButton ? 'center' : mapTextContentAlign(renderStyle)
                    return (
                  <span
                    className="view-node-text"
                    style={{
                      ...typographyStyle,
                      width: '100%',
                      display: centeredLike || pillLike ? 'inline-flex' : 'block',
                      alignItems: centeredLike || pillLike ? contentAlignItems : undefined,
                      justifyContent: centeredLike || pillLike ? (centeredLike ? 'center' : undefined) : undefined,
                      wordBreak: singleLine ? 'normal' : (renderStyle?.wordBreak === 'break-word' ? 'break-word' : undefined),
                      overflowWrap: singleLine ? 'normal' : (renderStyle?.wordBreak === 'break-word' ? 'anywhere' : undefined),
                      textOverflow: renderStyle?.textOverflow?.toLowerCase().includes('clip') ? 'clip' : undefined,
                      whiteSpace: singleLine ? 'nowrap' : undefined,
                      lineHeight: shouldForceSingleLineHeight ? singleLineHeight : typographyStyle.lineHeight,
                    }}
                  >
                    {positioned.node.text}
                  </span>
                    )
                  })()
                ) : null}
                {showNodeChrome ? (
                  <>
                    <span className="view-node-meta">{positioned.node.id}</span>
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ViewGraph3D({
  nodes,
  selectedNodeKey,
  onSelect,
  showConnections,
  platform,
  allowUpscale,
  captureMode,
  disableAutoFit,
}: {
  nodes: FlattenedViewNode[]
  selectedNodeKey: string | null
  onSelect: (nodeKey: string) => void
  showConnections: boolean
  platform: RenderPlatform
  allowUpscale?: boolean
  captureMode?: boolean
  disableAutoFit?: boolean
}) {
  const scene = useMemo(() => createViewScene(nodes, platform), [nodes, platform])
  const hasSelection = selectedNodeKey !== null
  const positionedNodes = useMemo(
    () =>
      createPositionedNodes(scene.nodes, scene, { xByDepth: 170, yByOrder: 60 }).sort((left, right) => {
        if (left.renderOrder !== right.renderOrder) {
          return left.renderOrder - right.renderOrder
        }
        return left.node.order - right.node.order
      }),
    [scene.nodes],
  )
  const viewEdges = useMemo(
    () => (showConnections ? createViewEdges(positionedNodes, selectedNodeKey) : []),
    [positionedNodes, selectedNodeKey, showConnections],
  )
  const sceneWidth = scene.bounds?.width ?? 980
  const sceneHeight = scene.bounds?.height ?? Math.max(640, positionedNodes.length * 60)
  const viewportWidth = scene.bounds?.viewportWidth ?? sceneWidth
  const viewportHeight = scene.bounds?.viewportHeight ?? sceneHeight
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fitScale = useFitScale(containerRef, viewportWidth, viewportHeight, allowUpscale ?? false)
  const baseScale = disableAutoFit ? 1 : fitScale
  const scaledWidth = Math.max(1, viewportWidth * baseScale)
  const scaledHeight = Math.max(1, viewportHeight * baseScale)
  const stageBackgroundColor = useMemo(
    () => inferStageBackgroundColor(positionedNodes, platform),
    [positionedNodes, platform],
  )

  return (
    <div
      className={`view-graph-3d-wrap ${hasSelection ? 'view-selection-active' : ''}`}
      data-testid="view-canvas-3d"
      ref={containerRef}
    >
      <div className="view-graph view-graph-3d">
        <div className="view-stage-viewport" style={{ width: `${String(scaledWidth)}px`, height: `${String(scaledHeight)}px` }}>
          <div
            className={`view-stage view-stage-scaled ${
              scene.bounds ? (captureMode ? 'view-stage-plain' : 'view-stage-framed') : 'view-stage-fallback'
            }`}
            style={{
              width: `${String(sceneWidth)}px`,
              height: `${String(sceneHeight)}px`,
              transform: `scale(${String(baseScale)})`,
              backgroundColor: stageBackgroundColor,
            }}
          >
            {showConnections ? (
              <svg className="view-links-layer" width={sceneWidth} height={sceneHeight} aria-hidden="true">
                {viewEdges.map((edge) => (
                  <line
                    key={edge.id}
                    className={`view-link relation-${edge.relation}`}
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                  />
                ))}
              </svg>
            ) : null}
            {positionedNodes.map((positioned) => {
              const z = positioned.node.depth * 28 + positioned.zIndex * 2
              const hasFrame = positioned.node.frame !== undefined && scene.bounds !== null
              const relation = relationOfNode(positioned.node.keyPath, selectedNodeKey)
              const baseRenderStyle = normalizeRenderStyle(positioned.node.style, platform)
              const renderStyle = applyPlatformRenderFallback(
                baseRenderStyle,
                positioned.node,
                positioned.height,
                platform,
              )
              const typographyStyle = createTypographyStyle(renderStyle, platform)
              const isCenteredButton =
                platform === 'harmony' &&
                positioned.node.name === 'Button' &&
                typographyStyle.textAlign === 'center'
              const isRootWhiteFill =
                captureMode &&
                positioned.node.depth === 0 &&
                (renderStyle?.backgroundColor?.toUpperCase() === '#FFFFFFFF' ||
                  renderStyle?.backgroundColor?.toUpperCase() === '#FFFFFF')
              const shouldClipNode = hasFrame && positioned.node.name !== 'Text'
              return (
                <div
                  key={positioned.node.keyPath}
                  className={`view-node view-node-3d ${hasFrame ? 'view-node-framed' : ''} relation-${relation}`}
                  data-node-key={positioned.node.keyPath}
                  style={{
                    transform: `translate3d(${String(positioned.x)}px, ${String(positioned.y)}px, ${String(z)}px)`,
                    width: `${String(positioned.width)}px`,
                    height: `${String(positioned.height)}px`,
                    overflow: shouldClipNode ? 'hidden' : undefined,
                    opacity: renderStyle?.opacity,
                    backgroundColor: isRootWhiteFill ? 'transparent' : renderStyle?.backgroundColor,
                    borderColor: renderStyle?.borderColor,
                    borderWidth: renderStyle?.borderWidth,
                    borderRadius: renderStyle?.borderRadius,
                    color: renderStyle?.textColor,
                    zIndex: positioned.renderOrder,
                    justifyContent: isCenteredButton ? 'center' : undefined,
                    alignItems: isCenteredButton ? 'center' : undefined,
                    paddingTop: toPixelLength(renderStyle?.paddingTop),
                    paddingRight: toPixelLength(renderStyle?.paddingRight),
                    paddingBottom: toPixelLength(renderStyle?.paddingBottom),
                    paddingLeft: toPixelLength(renderStyle?.paddingLeft),
                  }}
                  onClick={() => onSelect(positioned.node.keyPath)}
                >
                  <span className="view-node-name">{positioned.node.name}</span>
                  {positioned.node.text ? (
                    (() => {
                      const pillLike =
                        ((renderStyle?.borderRadius ?? 0) > 0 &&
                          !!renderStyle?.backgroundColor &&
                          renderStyle.backgroundColor.toUpperCase() !== '#00000000')
                      const centeredLike = typographyStyle.textAlign === 'center'
                      const singleLine = shouldRenderSingleLineText(renderStyle, positioned.height, positioned.node.text)
                      const singleLineHeight = `${String(positioned.height)}px`
                      const shouldForceSingleLineHeight = singleLine && typographyStyle.lineHeight === undefined
                      const contentAlignItems = isCenteredButton ? 'center' : mapTextContentAlign(renderStyle)
                      return (
                    <span
                      className="view-node-text"
                      style={{
                        ...typographyStyle,
                        width: '100%',
                        display: centeredLike || pillLike ? 'inline-flex' : 'block',
                        alignItems: centeredLike || pillLike ? contentAlignItems : undefined,
                        justifyContent: centeredLike || pillLike ? (centeredLike ? 'center' : undefined) : undefined,
                        wordBreak: singleLine ? 'normal' : (renderStyle?.wordBreak === 'break-word' ? 'break-word' : undefined),
                        overflowWrap: singleLine ? 'normal' : (renderStyle?.wordBreak === 'break-word' ? 'anywhere' : undefined),
                        textOverflow: renderStyle?.textOverflow?.toLowerCase().includes('clip') ? 'clip' : undefined,
                        whiteSpace: singleLine ? 'nowrap' : undefined,
                        lineHeight: shouldForceSingleLineHeight ? singleLineHeight : typographyStyle.lineHeight,
                      }}
                    >
                      {positioned.node.text}
                    </span>
                      )
                    })()
                  ) : null}
                  <span className="view-node-meta">{positioned.node.id}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ViewInfoPage({ mockOnly = false, mockPlatform = 'harmony', replayMode = false }: ViewInfoPageProps = {}) {
  const { clientKey = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const identity = useMemo<ViewIdentity>(() => {
    if (mockOnly) {
      return {
        platform: mockPlatform,
        appId: `mock.tree.snapshot.${mockPlatform}`,
        sessionId: 'mock-session',
        deviceId: 'mock-device',
      }
    }
    return decodeClientKey(clientKey)
  }, [clientKey, mockOnly, mockPlatform])
  const [baseUrl] = useState(() => normalizeBaseUrl(safeStorageGet(BASE_URL_STORAGE_KEY) ?? DEFAULT_BASE_URL))
  const [snapshot, setSnapshot] = useState<ViewTreeSnapshot | null>(null)
  const [mode, setMode] = useState<ViewRenderMode>('2d')
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)
  const [showConnections, setShowConnections] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const isReplayMode = useMemo(() => {
    if (!mockOnly) {
      return false
    }
    if (replayMode) {
      return true
    }
    return searchParams.get('replay') === '1'
  }, [mockOnly, replayMode, searchParams])
  const isCaptureMode = useMemo(() => {
    if (!isReplayMode) {
      return false
    }
    return searchParams.get('capture') === '1'
  }, [isReplayMode, searchParams])
  const useMockSnapshot = useMemo(() => {
    if (mockOnly) {
      return true
    }
    return searchParams.get('mock') === '1'
  }, [mockOnly, searchParams])

  const activeMockPlatform = useMemo<MockPlatform>(() => {
    if (mockOnly) {
      return mockPlatform
    }
    if (identity?.platform === 'ios' || identity?.platform === 'android' || identity?.platform === 'harmony') {
      return identity.platform
    }
    return 'harmony'
  }, [identity?.platform, mockOnly, mockPlatform])
  const replayDeviceViewport = useMemo<DeviceViewport | null>(() => {
    if (!isReplayMode) {
      return null
    }
    const platform = snapshot?.platform
    if (platform === 'ios' || platform === 'android' || platform === 'harmony') {
      return REPLAY_DEVICE_VIEWPORTS[platform]
    }
    return REPLAY_DEVICE_VIEWPORTS[activeMockPlatform]
  }, [activeMockPlatform, isReplayMode, snapshot?.platform])

  const loadSnapshot = useCallback(async (forceRefresh = false) => {
    if (!identity) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      let data: ViewTreeSnapshot
      if (useMockSnapshot) {
        data = await fetchMockViewSnapshot(activeMockPlatform)
      } else {
        try {
          data = await fetchViewSnapshot(baseUrl, identity, { refresh: forceRefresh })
        } catch (firstError) {
          const shouldRetry =
            forceRefresh &&
            firstError instanceof Error &&
            firstError.message.includes('404')
          if (!shouldRetry) {
            throw firstError
          }
          await delay(450)
          data = await fetchViewSnapshot(baseUrl, identity, { refresh: true })
        }
      }
      setSnapshot(data)
      setSelectedNodeKey(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSnapshot(null)
    } finally {
      setLoading(false)
    }
  }, [activeMockPlatform, baseUrl, identity, useMockSnapshot])

  useEffect(() => {
    void loadSnapshot(false)
  }, [loadSnapshot])

  const flattenedNodes = useMemo(() => flattenViewTree(snapshot?.roots ?? []), [snapshot])
  const selectedNode = useMemo(
    () => flattenedNodes.find((node) => node.keyPath === selectedNodeKey) ?? null,
    [flattenedNodes, selectedNodeKey],
  )
  const selectedCanonicalWeight = useMemo(
    () => canonicalFontWeight(selectedNode?.style),
    [selectedNode],
  )
  const maxDepth = useMemo(
    () => flattenedNodes.reduce((depth, node) => (node.depth > depth ? node.depth : depth), 0),
    [flattenedNodes],
  )

  useEffect(() => {
    if (!selectedNodeKey) {
      return
    }
    flyToNode(selectedNodeKey)
  }, [selectedNodeKey, mode])

  if (!identity) {
    return (
      <main className="page detail-page">
        <div className="error-box">无效客户端标识，无法查看视图信息。</div>
        <Link className="link-btn" to="/">
          返回首页
        </Link>
      </main>
    )
  }

  if (isReplayMode) {
    return (
      <main className={`page detail-page replay-page ${isCaptureMode ? 'replay-page-capture' : ''}`}>
        {isCaptureMode ? null : (
          <div className="replay-toolbar">
            <div className="view-mode-switch">
              <button
                className={`mode-btn ${mode === '2d' ? 'mode-btn-active' : ''}`}
                onClick={() => setMode('2d')}
                style={{ height: '26px', padding: '0 12px' }}
              >
                2D
              </button>
              <button
                className={`mode-btn ${mode === '3d' ? 'mode-btn-active' : ''}`}
                onClick={() => setMode('3d')}
                style={{ height: '26px', padding: '0 12px' }}
              >
                3D
              </button>
            </div>
            <div className="view-mode-switch">
              {(['harmony', 'ios', 'android'] as MockPlatform[]).map((platform) => (
                <button
                  key={platform}
                  className={`mode-btn ${activeMockPlatform === platform ? 'mode-btn-active' : ''}`}
                  onClick={() => {
                    const next = new URLSearchParams(searchParams)
                    next.set('platform', platform)
                    next.set('replay', '1')
                    setSearchParams(next, { replace: true })
                  }}
                  style={{ height: '26px', padding: '0 10px', textTransform: 'uppercase' }}
                >
                  {platform}
                </button>
              ))}
            </div>
            <button className="mode-btn mode-btn-active" onClick={() => void loadSnapshot(true)}>
              refresh
            </button>
            <span className="status-pill">{loading ? 'LOADING' : 'READY'}</span>
          </div>
        )}
        <section className="replay-canvas-shell">
          {error ? <div className="error-box">{error}</div> : null}
          {!loading && !error && !snapshot ? <div className="empty">暂无视图。</div> : null}
          {snapshot ? (
            <div
              className={`replay-canvas-scroller ${isCaptureMode ? 'replay-canvas-scroller-capture' : ''}`}
              style={isCaptureMode ? { justifyContent: 'flex-start', alignItems: 'flex-start', padding: 0 } : undefined}
            >
              <div
                className="replay-device-frame"
                data-testid="replay-device-frame"
                data-platform={snapshot.platform}
                style={{
                  width: replayDeviceViewport ? `${String(replayDeviceViewport.width)}px` : undefined,
                  height: replayDeviceViewport ? `${String(replayDeviceViewport.height)}px` : undefined,
                }}
              >
                {mode === '2d' ? (
                  <ViewGraph2D
                    nodes={flattenedNodes}
                    selectedNodeKey={selectedNodeKey}
                    onSelect={setSelectedNodeKey}
                    showConnections={false}
                    platform={snapshot.platform as RenderPlatform}
                    allowUpscale
                    captureMode={isCaptureMode}
                  />
                ) : (
                  <ViewGraph3D
                    nodes={flattenedNodes}
                    selectedNodeKey={selectedNodeKey}
                    onSelect={setSelectedNodeKey}
                    showConnections={false}
                    platform={snapshot.platform as RenderPlatform}
                    allowUpscale
                    captureMode={isCaptureMode}
                  />
                )}
              </div>
            </div>
          ) : null}
        </section>
      </main>
    )
  }

  return (
    <main className="page detail-page">
      <header className="page-header">
        <div className="header-content">
            <nav className="breadcrumb">
              <Link className="breadcrumb-link" to="/">Neptune</Link>
              <span className="breadcrumb-separator">/</span>
              {mockOnly ? null : (
                <>
                  <Link className="breadcrumb-link" to={`/clients/${clientKey}`}>Client Detail</Link>
                  <span className="breadcrumb-separator">/</span>
                </>
              )}
              <span className="breadcrumb-current">View Info</span>
            </nav>
          <h1>视图信息 · {identity.platform} / {identity.appId}</h1>
          <div className="header-meta">
            <span className="meta-chip"><span className="meta-key">session</span><span className="meta-val">{identity.sessionId}</span></span>
            <span className="meta-chip"><span className="meta-key">device</span><span className="meta-val">{identity.deviceId}</span></span>
          </div>
        </div>
      </header>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)' }}>
        <div className="panel-title-row">
          <h2>视图检查器</h2>
          <div className="toolbar">
            <div className="view-mode-switch">
              <button
                className={`mode-btn ${mode === '2d' ? 'mode-btn-active' : ''}`}
                onClick={() => setMode('2d')}
                style={{ height: '24px', padding: '0 12px' }}
              >
                2D
              </button>
              <button
                className={`mode-btn ${mode === '3d' ? 'mode-btn-active' : ''}`}
                onClick={() => setMode('3d')}
                style={{ height: '24px', padding: '0 12px' }}
              >
                3D
              </button>
            </div>
            {mockOnly ? (
              <div className="view-mode-switch">
                {(['harmony', 'ios', 'android'] as MockPlatform[]).map((platform) => (
                  <button
                    key={platform}
                    className={`mode-btn ${activeMockPlatform === platform ? 'mode-btn-active' : ''}`}
                    onClick={() => {
                      const next = new URLSearchParams(searchParams)
                      next.set('platform', platform)
                      setSearchParams(next, { replace: true })
                    }}
                    style={{ height: '24px', padding: '0 10px', textTransform: 'uppercase' }}
                  >
                    {platform}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="button-group" style={{ height: '28px', padding: '2px' }}>
              <button style={{ height: '22px' }} onClick={() => void loadSnapshot(true)}>刷新快照</button>
              <div className="divider" />
              <button 
                style={{ height: '22px', color: showConnections ? 'var(--accent-blue)' : 'inherit' }} 
                onClick={() => setShowConnections(!showConnections)}
              >
                显示连线
              </button>
            </div>
            <span className="status-pill">{loading ? 'LOADING' : useMockSnapshot ? 'MOCK' : 'READY'}</span>
          </div>
        </div>

        <div className="view-inspector-layout" style={{ border: 'none', borderRadius: 0, height: '100%' }}>
          {/* 左侧：组件树 */}
          <aside className="view-sidebar" style={{ width: '280px' }}>
            <div className="view-tree-meta">
              <span>Nodes: {flattenedNodes.length}</span>
              <span>Depth: {maxDepth}</span>
              {snapshot ? <span>Snapshot: {snapshot.snapshotId}</span> : null}
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '0.25rem 0' }}>
              {snapshot ? (
                <ul className="view-tree-list view-tree-list-root">
                  {snapshot.roots.map((node, index) => (
                    <ViewTreeNodeItem
                      key={`root.${String(index)}.${node.id}`}
                      node={node}
                      path={`root.${String(index)}`}
                      selectedNodeKey={selectedNodeKey}
                      onSelect={setSelectedNodeKey}
                    />
                  ))}
                </ul>
              ) : (
                <div className="empty">无快照</div>
              )}
            </div>
          </aside>

          {/* 中间：画布 */}
          <section className="view-main-content">
            {error ? <div className="error-box">{error}</div> : null}
            {!loading && !error && !snapshot ? <div className="empty">暂无视图。</div> : null}
            {snapshot && (
              <>
                {mode === '2d' ? (
                  <ViewGraph2D
                    nodes={flattenedNodes}
                    selectedNodeKey={selectedNodeKey}
                    onSelect={setSelectedNodeKey}
                    showConnections={showConnections}
                    platform={snapshot.platform as RenderPlatform}
                    allowUpscale
                    disableAutoFit
                  />
                ) : (
                  <ViewGraph3D
                    nodes={flattenedNodes}
                    selectedNodeKey={selectedNodeKey}
                    onSelect={setSelectedNodeKey}
                    showConnections={showConnections}
                    platform={snapshot.platform as RenderPlatform}
                    allowUpscale
                    disableAutoFit
                  />
                )}
              </>
            )}
          </section>
          
          {/* 右侧：属性面板 */}
          <aside className="view-properties-panel" style={{ width: '320px' }}>
            {selectedNode ? (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <PropertySection title="Basic Info">
                  <PropertyRow label="Name" value={selectedNode.name} highlight />
                  <PropertyRow label="ID" value={selectedNode.id} />
                  <PropertyRow label="Depth" value={selectedNode.depth} />
                  <PropertyRow label="Visible" value={selectedNode.visible !== false ? 'True' : 'False'} />
                </PropertySection>

                {selectedNode.frame && (
                  <PropertySection title="Layout">
                    <div className="prop-grid-2">
                      <div className="prop-grid-item"><span className="prop-grid-label">X</span><span className="prop-val">{selectedNode.frame.x}</span></div>
                      <div className="prop-grid-item"><span className="prop-grid-label">Y</span><span className="prop-val">{selectedNode.frame.y}</span></div>
                      <div className="prop-grid-item"><span className="prop-grid-label">W</span><span className="prop-val">{selectedNode.frame.width}</span></div>
                      <div className="prop-grid-item"><span className="prop-grid-label">H</span><span className="prop-val">{selectedNode.frame.height}</span></div>
                    </div>
                  </PropertySection>
                )}

                {selectedNode.attributes && Object.keys(selectedNode.attributes).length > 0 && (
                  <PropertySection title="Attributes" defaultOpen={false}>
                    <pre className="prop-json">
                      {JSON.stringify(selectedNode.attributes, null, 2)}
                    </pre>
                  </PropertySection>
                )}
                
                {selectedNode.style && Object.keys(selectedNode.style).length > 0 && (
                  <PropertySection title="Typography">
                    <PropertyRow label="Unit" value={selectedNode.style.typographyUnit ?? '-'} />
                    <PropertyRow label="Source Unit" value={selectedNode.style.sourceTypographyUnit ?? '-'} />
                    <PropertyRow label="Font Size" value={selectedNode.style.fontSize ?? '-'} />
                    <PropertyRow label="Line Height" value={selectedNode.style.lineHeight ?? '-'} />
                    <PropertyRow label="Letter Spacing" value={selectedNode.style.letterSpacing ?? '-'} />
                    <PropertyRow label="Font Weight" value={selectedNode.style.fontWeight ?? '-'} />
                    <PropertyRow label="Weight Raw" value={selectedNode.style.fontWeightRaw ?? '-'} />
                    <PropertyRow label="Canonical Weight" value={selectedCanonicalWeight ?? '-'} />
                    <PropertyRow label="Font Scale" value={selectedNode.style.platformFontScale ?? '-'} />
                  </PropertySection>
                )}

                {selectedNode.style && Object.keys(selectedNode.style).length > 0 && (
                  <PropertySection title="Styles" defaultOpen={false}>
                    <pre className="prop-json">
                      {JSON.stringify(selectedNode.style, null, 2)}
                    </pre>
                  </PropertySection>
                )}
              </div>
            ) : (
              <div className="empty" style={{ padding: '2rem 1rem' }}>选择一个节点查看详细属性。</div>
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}
