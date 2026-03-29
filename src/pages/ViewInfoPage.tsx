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
  rawNode?: unknown
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

function computeNodeClipPath(
  node: PositionedNode,
  positionedMap: Map<string, PositionedNode>,
  styleMap: Map<string, ViewTreeNode['style'] | undefined>,
): string | undefined {
  let topInset = 0
  let rightInset = 0
  let bottomInset = 0
  let leftInset = 0
  let hasClippingAncestor = false
  let maxAncestorRadius = 0

  let ancestorKey = parentKeyOf(node.node.keyPath)
  while (ancestorKey) {
    const ancestor = positionedMap.get(ancestorKey)
    if (ancestor && ancestor.node.frame && ancestor.node.name !== 'Text') {
      const ancestorRadius = styleMap.get(ancestorKey)?.borderRadius ?? 0
      if (ancestorRadius > 0) {
        hasClippingAncestor = true
        leftInset = Math.max(leftInset, ancestor.x - node.x)
        topInset = Math.max(topInset, ancestor.y - node.y)
        rightInset = Math.max(rightInset, (node.x + node.width) - (ancestor.x + ancestor.width))
        bottomInset = Math.max(bottomInset, (node.y + node.height) - (ancestor.y + ancestor.height))
        if (ancestorRadius > maxAncestorRadius) {
          maxAncestorRadius = ancestorRadius
        }
      }
    }
    ancestorKey = parentKeyOf(ancestorKey)
  }

  if (!hasClippingAncestor) {
    return undefined
  }

  const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max))
  const top = clamp(topInset, node.height)
  const right = clamp(rightInset, node.width)
  const bottom = clamp(bottomInset, node.height)
  const left = clamp(leftInset, node.width)

  if (top + bottom >= node.height || left + right >= node.width) {
    return 'inset(50%)'
  }

  if (maxAncestorRadius > 0) {
    return `inset(${String(top)}px ${String(right)}px ${String(bottom)}px ${String(left)}px round ${String(maxAncestorRadius)}px)`
  }
  return `inset(${String(top)}px ${String(right)}px ${String(bottom)}px ${String(left)}px)`
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

function isNodeKeyHidden(nodeKey: string, hiddenNodeKeys: readonly string[]): boolean {
  return hiddenNodeKeys.some((hiddenKey) => nodeKey === hiddenKey || nodeKey.startsWith(`${hiddenKey}.`))
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
  const hasBg = style.backgroundColor !== undefined && (bgAlpha === null || bgAlpha > 0)

  const borderAlpha = parseHexAlpha(style.borderColor)
  const hasBorder = (style.borderWidth ?? 0) > 0 && style.borderColor !== undefined && (borderAlpha === null || borderAlpha > 0)

  return hasBg || hasBorder
}

function hasRenderableText(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.trim().length > 0
}

function isLayerLikeNodeName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return normalized === 'calayer' || normalized.endsWith('layer')
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
  if (isLayerLikeNodeName(node.name)) {
    return false
  }
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
  if (node.depth <= 1) {
    return true
  }
  return false
}

function isTransparentNode(node: ViewTreeNode | FlattenedViewNode): boolean {
  return !hasRenderableText(node.text) && !hasVisibleVisualStyle(node.style)
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
        : platform === 'ios'
          ? '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif'
          : platform === 'android'
            ? 'Roboto, "Noto Sans CJK SC", "Noto Sans", sans-serif'
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
  return frameHeight > 0 && frameHeight <= fontSize * 1.6
}

function normalizePlatformColor(color: string | undefined, _platform: RenderPlatform): string | undefined {
  if (!color || !color.startsWith('#')) {
    return color
  }
  const hex = color.slice(1)
  if (hex.length !== 8) {
    return color
  }
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
  if (platform === 'ios') {
    if (node.name === 'UIWindow') {
      return {
        ...style,
        backgroundColor: '#00000000',
      }
    }
    return style
  }

  if (platform !== 'harmony') {
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

function hasVisibleDescendant(node: ViewTreeNode): boolean {
  return node.children.some((child) => !isTransparentNode(child) || hasVisibleDescendant(child))
}

function ViewTreeNodeItem({
  node,
  path,
  selectedNodeKey,
  hiddenNodeKeys,
  onSelect,
  hideTransparent,
}: {
  node: ViewTreeNode
  path: string
  selectedNodeKey: string | null
  hiddenNodeKeys: readonly string[]
  onSelect: (nodeKey: string) => void
  hideTransparent: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  const hasChildren = node.children.length > 0
  const relation = relationOfNode(path, selectedNodeKey)
  const hidden = isNodeKeyHidden(path, hiddenNodeKeys)

  const isTransparent = isTransparentNode(node)
  if (hideTransparent && isTransparent) {
    const visibleInDescendants = hasVisibleDescendant(node)
    if (!visibleInDescendants) {
      return null
    }
  }
  const isDimmed = hideTransparent && isTransparent

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
            textOverflow: 'ellipsis',
            textDecoration: hidden ? 'line-through' : undefined,
            opacity: hidden ? 0.6 : (isDimmed ? 0.4 : 1)
          }}>
            {node.name}
          </span>
          {hidden ? (
            <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', border: '1px solid var(--border-default)', borderRadius: 4, padding: '0 4px' }}>
              hidden
            </span>
          ) : null}
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
              hiddenNodeKeys={hiddenNodeKeys}
              onSelect={onSelect}
              hideTransparent={hideTransparent}
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

  const fallbackRawNodePayload = (node: ViewTreeNode) => ({
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    frame: node.frame,
    style: node.style,
    constraints: node.constraints,
    text: node.text,
    visible: node.visible,
    childCount: node.children.length,
  })

  const walk = (node: ViewTreeNode, depth: number, keyPath: string, siblingCount: number): void => {
    output.push({
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      frame: node.frame,
      style: node.style,
      rawNode: node.rawNode ?? fallbackRawNodePayload(node),
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
  if (isLayerLikeNodeName(node.name)) {
    return false
  }
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

  const contentMinX = Math.min(...framedNodes.map((node) => node.frame?.x ?? 0))
  const contentMinY = Math.min(...framedNodes.map((node) => node.frame?.y ?? 0))
  const contentMaxX = Math.max(...framedNodes.map((node) => {
    const frame = node.frame
    return frame ? frame.x + frame.width : 0
  }))
  const contentMaxY = Math.max(...framedNodes.map((node) => {
    const frame = node.frame
    return frame ? frame.y + frame.height : 0
  }))

  const minX = Math.min(0, contentMinX)
  const minY = Math.min(0, contentMinY)
  const anchorWidth = Math.max(1, anchorNode.frame?.width ?? 1)
  const anchorHeight = Math.max(1, anchorNode.frame?.height ?? 1)

  return {
    nodes: visibleNodes,
    bounds: {
      minX,
      minY,
      width: Math.max(anchorWidth, contentMaxX - minX),
      height: Math.max(anchorHeight, contentMaxY - minY),
      viewportWidth: anchorWidth,
      viewportHeight: anchorHeight,
    },
  }
}

function inferStageBackgroundColor(
  positionedNodes: PositionedNode[],
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
    if (isLayerLikeNodeName(root.node.name)) {
      continue
    }
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
    if (isLayerLikeNodeName(item.node.name)) {
      continue
    }
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

interface ViewGraphProps {
  mode: ViewRenderMode
  nodes: FlattenedViewNode[]
  selectedNodeKey: string | null
  onSelect: (nodeKey: string) => void
  showConnections: boolean
  hideTransparent: boolean
  platform: RenderPlatform
  captureMode?: boolean
  pan: { x: number; y: number }
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
  zoom: number
  setZoom: React.Dispatch<React.SetStateAction<number>>
  rotation: { x: number; y: number }
  setRotation: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
  containerRef: RefObject<HTMLDivElement | null>
}

function ViewGraph({
  mode,
  nodes,
  selectedNodeKey,
  onSelect,
  showConnections,
  hideTransparent,
  platform,
  captureMode,
  pan,
  setPan,
  zoom,
  setZoom,
  rotation,
  setRotation,
  containerRef,
}: ViewGraphProps) {
  const scene = useMemo(() => createViewScene(nodes, platform), [nodes, platform])
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
  const renderableNodes = useMemo(
    () =>
      positionedNodes.filter((item) => {
        if (isLayerLikeNodeName(item.node.name)) {
          return false
        }
        const relation = relationOfNode(item.node.keyPath, selectedNodeKey)
        if (relation !== 'none') {
          return true
        }
        if (hideTransparent && isTransparentNode(item.node)) {
          return false
        }
        return isVisuallyRenderableNode(item.node, platform)
      }),
    [positionedNodes, selectedNodeKey, platform, hideTransparent],
  )
  const compressedDepthMap = useMemo(() => {
    const map = new Map<string, number>()
    if (!hideTransparent) {
      return map
    }
    const sortedRenderable = [...renderableNodes].sort((a, b) => a.node.depth - b.node.depth)
    for (const item of sortedRenderable) {
      const key = item.node.keyPath
      let currentVisibleDepth = 0
      let parentKey = parentKeyOf(key)
      while (parentKey) {
        if (map.has(parentKey)) {
          currentVisibleDepth = map.get(parentKey)! + 1
          break
        }
        parentKey = parentKeyOf(parentKey)
      }
      map.set(key, currentVisibleDepth)
    }
    return map
  }, [renderableNodes, hideTransparent])
  const viewEdges = useMemo(
    () => (showConnections ? createViewEdges(positionedNodes, selectedNodeKey) : []),
    [positionedNodes, selectedNodeKey, showConnections],
  )

  const clipPathByNodeKey = useMemo(() => {
    const positionedMap = new Map(positionedNodes.map((item) => [item.node.keyPath, item] as const))
    const styleMap = new Map<string, ViewTreeNode['style'] | undefined>()
    for (const item of positionedNodes) {
      styleMap.set(
        item.node.keyPath,
        applyPlatformRenderFallback(
          normalizeRenderStyle(item.node.style, platform),
          item.node,
          item.height,
          platform,
        ),
      )
    }

    const clipMap = new Map<string, string>()
    for (const item of positionedNodes) {
      const clipPath = computeNodeClipPath(item, positionedMap, styleMap)
      if (clipPath) {
        clipMap.set(item.node.keyPath, clipPath)
      }
    }
    return clipMap
  }, [positionedNodes, platform])

  const dragRef = useRef({ 
    isDragging: false, 
    dragMode: 'none' as 'rotate' | 'pan', 
    startX: 0, 
    startY: 0, 
    initialRotation: { x: 0, y: 0 }, 
    initialPan: { x: 0, y: 0 },
    moved: false
  })

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
    if ((e.target as HTMLElement).closest('.view-zoom-control')) return

    const isPan = e.button === 2 || e.shiftKey || (mode === '2d' && e.button === 0)
    
    dragRef.current = {
      isDragging: true,
      dragMode: isPan ? 'pan' : 'rotate',
      startX: e.pageX,
      startY: e.pageY,
      initialRotation: { ...rotation },
      initialPan: { ...pan },
      moved: false
    }
    
    if (containerRef.current) {
      containerRef.current.style.cursor = dragRef.current.dragMode === 'pan' ? 'grabbing' : 'move'
    }
  }, [rotation, pan, mode, containerRef])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.isDragging) return
    e.preventDefault()

    const dx = e.pageX - dragRef.current.startX
    const dy = e.pageY - dragRef.current.startY

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true
    }

    if (dragRef.current.dragMode === 'rotate') {
      setRotation({
        x: dragRef.current.initialRotation.x - dy * 0.5,
        y: dragRef.current.initialRotation.y + dx * 0.5
      })
    } else {
      setPan({
        x: dragRef.current.initialPan.x + dx,
        y: dragRef.current.initialPan.y + dy
      })
    }
  }, [setRotation, setPan])

  const handleMouseUp = useCallback(() => {
    if (!dragRef.current.isDragging) return
    dragRef.current.isDragging = false
    if (containerRef.current) {
      containerRef.current.style.cursor = ''
    }
  }, [containerRef])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const direction = e.deltaY > 0 ? -1 : 1
      setZoom((prev) => Math.max(0.05, Math.min(4, prev + direction * 0.05)))
    } else {
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY
      }))
    }
  }, [setZoom, setPan])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [containerRef, handleWheel])

  const sceneWidth = scene.bounds?.width ?? 980
  const sceneHeight = scene.bounds?.height ?? 640
  const stageBackgroundColor = useMemo(
    () => mode === '2d' ? inferStageBackgroundColor(renderableNodes, platform) : 'transparent',
    [renderableNodes, platform, mode],
  )

  return (
    <div
      data-testid={mode === '3d' ? 'view-canvas-3d' : 'view-canvas-2d'}
      className={`view-graph ${mode === '3d' ? 'view-graph-3d-wrap' : 'view-graph-2d'} ${hasSelection ? 'view-selection-active' : ''}`}
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{ 
        overflow: 'hidden', 
        cursor: 'grab', 
        background: mode === '3d' ? 'radial-gradient(circle at 50% 50%, #1e293b 0%, #020617 100%)' : undefined, 
        perspective: '2000px',
        perspectiveOrigin: '50% 50%',
        position: 'relative',
        flex: 1,
        width: '100%',
        height: '100%',
        touchAction: 'none',
        overscrollBehavior: 'none',
        transition: 'background 0.6s ease'
      }}
    >
      {captureMode ? null : (
        <div className="view-zoom-control">
          <button onClick={() => setZoom((value) => Math.max(0.1, value - 0.1))}>-</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((value) => Math.min(3, value + 0.1))}>+</button>
        </div>
      )}
      <div 
        className="view-stage-viewport" 
        style={{ 
          width: `${String(sceneWidth)}px`, 
          height: `${String(sceneHeight)}px`,
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) scale3d(${zoom}, ${zoom}, ${zoom})`,
          transformOrigin: '50% 50%',
          transformStyle: 'preserve-3d',
          transition: dragRef.current.isDragging ? 'none' : 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.6s ease',
          backgroundColor: stageBackgroundColor,
          position: 'absolute',
          left: 0,
          top: 0,
          backfaceVisibility: 'hidden',
        }}
      >
        <div
          className={`view-stage ${
            scene.bounds ? (captureMode ? 'view-stage-plain' : 'view-stage-framed') : 'view-stage-fallback'
          }`}
          style={{
            width: `${String(sceneWidth)}px`,
            height: `${String(sceneHeight)}px`,
            transformStyle: 'preserve-3d',
            borderRadius: 0,
            boxShadow: mode === '2d' && scene.bounds && !captureMode ? '0 0 0 1px rgba(255, 255, 255, 0.1), 0 18px 28px rgba(4, 8, 21, 0.35)' : undefined,
            transition: 'box-shadow 0.6s ease, border-radius 0.6s ease',
            backfaceVisibility: 'hidden',
          }}
        >
          {showConnections ? (
            <svg className="view-links-layer" width={sceneWidth} height={sceneHeight} aria-hidden="true" style={{ transform: 'translateZ(1px)' }}>
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
            const depth = hideTransparent ? (compressedDepthMap.get(positioned.node.keyPath) ?? 0) : positioned.node.depth
            const z = mode === '3d' ? (depth * 100 + positioned.zIndex * 4) : 0
            const hasFrame = positioned.node.frame !== undefined && scene.bounds !== null
            const relation = relationOfNode(positioned.node.keyPath, selectedNodeKey)
            const isTransparent = isTransparentNode(positioned.node)
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
            
            let backgroundColor = renderStyle?.backgroundColor
            if (mode === '3d') {
              const isRoot = positioned.node.depth === 0
              const nodeBg = isRootWhiteFill ? 'transparent' : renderStyle?.backgroundColor
              backgroundColor = (nodeBg && nodeBg.toLowerCase() !== '#00000000') 
                ? nodeBg 
                : (isRoot ? '#141416' : nodeBg)
            } else {
              backgroundColor = isRootWhiteFill ? 'transparent' : renderStyle?.backgroundColor
            }

            const shouldClipNode = hasFrame && positioned.node.name !== 'Text'
            const pointerEvents = (hideTransparent && isTransparent && relation !== 'selected') ? 'none' : undefined

            return (
              <div
                key={positioned.node.keyPath}
                className={`view-node ${mode === '3d' ? 'view-node-3d' : 'view-node-2d'} ${hasFrame ? 'view-node-framed' : ''} relation-${relation}`}
                data-node-key={positioned.node.keyPath}
                style={{
                  transform: `translate3d(${String(positioned.x)}px, ${String(positioned.y)}px, ${String(z)}px)`,
                  width: `${String(positioned.width)}px`,
                  height: `${String(positioned.height)}px`,
                  overflow: shouldClipNode ? 'hidden' : undefined,
                  opacity: renderStyle?.opacity,
                  backgroundColor,
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
                  clipPath: clipPathByNodeKey.get(positioned.node.keyPath),
                  outline: mode === '3d' ? '1px solid rgba(255,255,255,0.1)' : undefined,
                  boxShadow: mode === '3d' ? (relation === 'selected' ? undefined : '0 2px 8px rgba(0,0,0,0.4)') : undefined,
                  transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.6s, background-color 0.6s, box-shadow 0.6s, outline 0.6s',
                  transformStyle: 'preserve-3d',
                  backfaceVisibility: 'hidden',
                  pointerEvents,
                }}
                onClick={(e) => {
                  if (dragRef.current.moved) return
                  e.stopPropagation()
                  onSelect(positioned.node.keyPath)
                }}
              >
                {positioned.node.text ? (
                  <span
                    className="view-node-text"
                    style={{
                      ...typographyStyle,
                      width: '100%',
                      height: (typographyStyle.textAlign === 'center') || ((renderStyle?.borderRadius ?? 0) > 0 && !!renderStyle?.backgroundColor && renderStyle.backgroundColor.toUpperCase() !== '#00000000') ? '100%' : undefined,
                      display: (typographyStyle.textAlign === 'center') || ((renderStyle?.borderRadius ?? 0) > 0 && !!renderStyle?.backgroundColor && renderStyle.backgroundColor.toUpperCase() !== '#00000000') ? 'flex' : 'block',
                      alignItems: isCenteredButton ? 'center' : mapTextContentAlign(renderStyle),
                      justifyContent: typographyStyle.textAlign === 'center' ? 'center' : undefined,
                      wordBreak: shouldRenderSingleLineText(renderStyle, positioned.height, positioned.node.text) ? 'normal' : (renderStyle?.wordBreak === 'break-word' ? 'break-word' : undefined),
                      overflowWrap: shouldRenderSingleLineText(renderStyle, positioned.height, positioned.node.text) ? 'normal' : (renderStyle?.wordBreak === 'break-word' ? 'anywhere' : undefined),
                      textOverflow: renderStyle?.textOverflow?.toLowerCase().includes('clip') ? 'clip' : undefined,
                      whiteSpace: shouldRenderSingleLineText(renderStyle, positioned.height, positioned.node.text) ? 'nowrap' : undefined,
                      lineHeight: shouldRenderSingleLineText(renderStyle, positioned.height, positioned.node.text) && typographyStyle.lineHeight === undefined ? `${String(positioned.height)}px` : typographyStyle.lineHeight,
                    }}
                  >
                    {positioned.node.text}
                  </span>
                ) : null}
              </div>
            )
          })}
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
  const [hiddenNodeKeys, setHiddenNodeKeys] = useState<string[]>([])
  const [showConnections, setShowConnections] = useState(false)
  const [hideTransparent, setHideTransparent] = useState(false)
  const [rawNodeCopyState, setRawNodeCopyState] = useState<'idle' | 'done' | 'error'>('idle')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(0.8)
  const [rotation, setRotation] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement | null>(null)

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
      setHiddenNodeKeys([])
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
  const visibleFlattenedNodes = useMemo(
    () => flattenedNodes.filter((node) => !isNodeKeyHidden(node.keyPath, hiddenNodeKeys)),
    [flattenedNodes, hiddenNodeKeys],
  )
  const selectedNode = useMemo(
    () => flattenedNodes.find((node) => node.keyPath === selectedNodeKey) ?? null,
    [flattenedNodes, selectedNodeKey],
  )
  const selectedNodeHidden = useMemo(
    () => (selectedNodeKey ? isNodeKeyHidden(selectedNodeKey, hiddenNodeKeys) : false),
    [selectedNodeKey, hiddenNodeKeys],
  )
  const selectedCanonicalWeight = useMemo(
    () => canonicalFontWeight(selectedNode?.style),
    [selectedNode],
  )
  const copyRawNode = useCallback(async () => {
    if (selectedNode?.rawNode == null) {
      return
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedNode.rawNode, null, 2))
      setRawNodeCopyState('done')
      window.setTimeout(() => setRawNodeCopyState('idle'), 1200)
    } catch {
      setRawNodeCopyState('error')
      window.setTimeout(() => setRawNodeCopyState('idle'), 1500)
    }
  }, [selectedNode?.rawNode])
  const maxDepth = useMemo(
    () => flattenedNodes.reduce((depth, node) => (node.depth > depth ? node.depth : depth), 0),
    [flattenedNodes],
  )

  const hideSelectedNode = useCallback(() => {
    if (!selectedNodeKey) {
      return
    }
    setHiddenNodeKeys((current) => (current.includes(selectedNodeKey) ? current : [...current, selectedNodeKey]))
  }, [selectedNodeKey])

  const unhideSelectedNode = useCallback(() => {
    if (!selectedNodeKey) {
      return
    }
    setHiddenNodeKeys((current) => current.filter((hiddenKey) => hiddenKey !== selectedNodeKey))
  }, [selectedNodeKey])

  const clearHiddenNodes = useCallback(() => {
    setHiddenNodeKeys([])
  }, [])

  const centerView = useCallback((nodeKey?: string | null, targetZoom?: number) => {
    if (!containerRef.current || !snapshot) return
    
    const platform = snapshot.platform as RenderPlatform
    const scene = createViewScene(flattenedNodes, platform)
    const positionedNodes = createPositionedNodes(scene.nodes, scene, { xByDepth: 190, yByOrder: 64 })
    
    const container = containerRef.current
    const cw = container.clientWidth
    const ch = container.clientHeight
    
    const sceneWidth = scene.bounds?.width ?? 980
    const sceneHeight = scene.bounds?.height ?? 640
    
    let tx, ty
    if (nodeKey) {
      const target = positionedNodes.find(n => n.node.keyPath === nodeKey)
      if (target) {
        tx = target.x + target.width / 2
        ty = target.y + target.height / 2
      } else {
        tx = sceneWidth / 2
        ty = sceneHeight / 2
      }
    } else {
      tx = sceneWidth / 2
      ty = sceneHeight / 2
    }

    const z = targetZoom ?? zoom
    setPan({
      x: cw / 2 - tx * z - (sceneWidth / 2) * (1 - z),
      y: ch / 2 - ty * z - (sceneHeight / 2) * (1 - z)
    })
  }, [snapshot, flattenedNodes, zoom])

  useEffect(() => {
    if (snapshot && containerRef.current) {
      centerView(null, mode === '2d' ? 0.8 : 0.6)
    }
  }, [snapshot])

  useEffect(() => {
    if (selectedNodeKey) {
      centerView(selectedNodeKey)
    }
  }, [selectedNodeKey])

  const handleSetMode = (newMode: ViewRenderMode) => {
    setMode(newMode)
    let nextZoom = zoom
    if (newMode === '2d') {
      setRotation({ x: 0, y: 0 })
      // When switching back to 2D, we can restore a more standard zoom if it was very small
      if (zoom < 0.6) {
        nextZoom = 0.8
      }
    } else {
      setRotation({ x: 35, y: -35 })
      // Auto-fit: decrease zoom by ~35% when entering 3D to fit exploded layers
      nextZoom = Math.max(0.1, zoom * 0.65)
    }
    setZoom(nextZoom)
    // Synchronize pan update to match rotation/zoom transition
    centerView(selectedNodeKey, nextZoom)
  }

  useEffect(() => {
    setRawNodeCopyState('idle')
  }, [selectedNodeKey])

  const [sidebarWidth, setSidebarWidth] = useState(280)
  const isResizingRef = useRef(false)

  const onResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    document.body.style.cursor = 'col-resize'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return
      const nextWidth = Math.max(160, Math.min(600, moveEvent.clientX))
      setSidebarWidth(nextWidth)
    }

    const handleMouseUp = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [])

  if (!identity) {
    return (
      <main className="page detail-page">
        <div className="error-box">Invalid client identity, cannot view info.</div>
        <Link className="link-btn" to="/">
          Back to Home
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
                onClick={() => handleSetMode('2d')}
                style={{ height: '26px', padding: '0 12px' }}
              >
                2D
              </button>
              <button
                className={`mode-btn ${mode === '3d' ? 'mode-btn-active' : ''}`}
                onClick={() => handleSetMode('3d')}
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
            <button 
              className="mode-btn" 
              onClick={() => setHideTransparent(!hideTransparent)}
              style={{ height: '26px', padding: '0 10px', color: hideTransparent ? 'var(--accent-blue)' : 'inherit' }}
            >
              hide transparent
            </button>
            <button className="mode-btn mode-btn-active" onClick={() => void loadSnapshot(true)}>
              refresh
            </button>
            <span className="status-pill">{loading ? 'LOADING' : 'READY'}</span>
          </div>
        )}
        <section className="replay-canvas-shell">
          {error ? <div className="error-box">{error}</div> : null}
          {!loading && !error && !snapshot ? <div className="empty">No view available.</div> : null}
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
                <ViewGraph
                  mode={mode}
                  nodes={visibleFlattenedNodes}
                  selectedNodeKey={selectedNodeKey}
                  onSelect={setSelectedNodeKey}
                  showConnections={false}
                  hideTransparent={hideTransparent}
                  platform={snapshot.platform as RenderPlatform}
                  captureMode={isCaptureMode}
                  pan={pan}
                  setPan={setPan}
                  zoom={zoom}
                  setZoom={setZoom}
                  rotation={rotation}
                  setRotation={setRotation}
                  containerRef={containerRef}
                />
              </div>
            </div>
          ) : null}
        </section>
      </main>
    )
  }

  return (
    <main className="page detail-page" style={{ maxWidth: 'none', padding: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <nav className="breadcrumb" style={{ margin: 0 }}>
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

        <div className="toolbar">
          <div className="view-mode-switch">
            <button
              className={`mode-btn ${mode === '2d' ? 'mode-btn-active' : ''}`}
              onClick={() => handleSetMode('2d')}
              style={{ height: '24px', padding: '0 12px' }}
            >
              2D
            </button>
            <button
              className={`mode-btn ${mode === '3d' ? 'mode-btn-active' : ''}`}
              onClick={() => handleSetMode('3d')}
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
            <button style={{ height: '22px' }} onClick={() => void loadSnapshot(true)}>Refresh Snapshot</button>
            <div className="divider" />
            <button 
              style={{ height: '22px', color: showConnections ? 'var(--accent-blue)' : 'inherit' }} 
              onClick={() => setShowConnections(!showConnections)}
            >
              Show Connections
            </button>
            <div className="divider" />
            <button 
              style={{ height: '22px', color: hideTransparent ? 'var(--accent-blue)' : 'inherit' }} 
              onClick={() => setHideTransparent(!hideTransparent)}
            >
              Hide Transparent
            </button>
            <div className="divider" />
            <button
              style={{ height: '22px' }}
              onClick={clearHiddenNodes}
              disabled={hiddenNodeKeys.length === 0}
            >
              Show All
            </button>
          </div>
          <span className="status-pill">{loading ? 'LOADING' : useMockSnapshot ? 'MOCK' : 'READY'}</span>
        </div>
      </header>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, border: 'none', borderRadius: 0, width: '100%' }}>
        <div className="view-inspector-layout" style={{ border: 'none', borderRadius: 0, height: '100%', gridTemplateColumns: `${sidebarWidth}px 4px 1fr 320px` }}>
          {/* Left: Component Tree */}
          <aside className="view-sidebar" style={{ width: `${sidebarWidth}px` }}>
            <div className="view-tree-meta">
              <span>Nodes: {visibleFlattenedNodes.length}/{flattenedNodes.length}</span>
              <span>Depth: {maxDepth}</span>
              <span>Hidden: {hiddenNodeKeys.length}</span>
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
                      hiddenNodeKeys={hiddenNodeKeys}
                      onSelect={setSelectedNodeKey}
                      hideTransparent={hideTransparent}
                    />
                  ))}
                </ul>
              ) : (
                <div className="empty">No Snapshot</div>
              )}
            </div>
          </aside>

          {/* Resizer Handle */}
          <div
            onMouseDown={onResizerMouseDown}
            style={{
              width: '4px',
              cursor: 'col-resize',
              background: 'transparent',
              borderRight: '1px solid var(--border)',
              zIndex: 10,
              transition: 'background 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'var(--accent-blue)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
          />

          {/* Middle: Canvas */}
          <section className="view-main-content">
            {error ? <div className="error-box">{error}</div> : null}
            {!loading && !error && !snapshot ? <div className="empty">No view available.</div> : null}
            {snapshot && (
              <ViewGraph
                mode={mode}
                nodes={visibleFlattenedNodes}
                selectedNodeKey={selectedNodeKey}
                onSelect={setSelectedNodeKey}
                showConnections={showConnections}
                hideTransparent={hideTransparent}
                platform={snapshot.platform as RenderPlatform}
                pan={pan}
                setPan={setPan}
                zoom={zoom}
                setZoom={setZoom}
                rotation={rotation}
                setRotation={setRotation}
                containerRef={containerRef}
              />
            )}
          </section>
          
          {/* Right: Properties Panel */}
          <aside className="view-properties-panel" style={{ width: '320px' }}>
            {selectedNode ? (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <PropertySection title="Basic Info">
                  <PropertyRow label="Name" value={selectedNode.name} highlight />
                  <PropertyRow label="ID" value={selectedNode.id} />
                  <PropertyRow label="Depth" value={selectedNode.depth} />
                  <PropertyRow label="Visible" value={selectedNode.visible !== false ? 'True' : 'False'} />
                  <PropertyRow label="Hidden In Canvas" value={selectedNodeHidden ? 'True' : 'False'} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px', gap: '6px' }}>
                    {selectedNodeHidden ? (
                      <button type="button" className="mode-btn" onClick={unhideSelectedNode} style={{ height: '24px', padding: '0 10px' }}>
                        Unhide
                      </button>
                    ) : (
                      <button type="button" className="mode-btn" onClick={hideSelectedNode} style={{ height: '24px', padding: '0 10px' }}>
                        Hide Node
                      </button>
                    )}
                  </div>
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

                {selectedNode.rawNode != null && (
                  <PropertySection title="Raw Node" defaultOpen={false}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        className="mode-btn"
                        onClick={() => { void copyRawNode() }}
                        style={{ height: '24px', padding: '0 10px' }}
                      >
                        {rawNodeCopyState === 'done' ? 'Copied' : rawNodeCopyState === 'error' ? 'Copy Failed' : 'Copy JSON'}
                      </button>
                    </div>
                    <pre className="prop-json">
                      {JSON.stringify(selectedNode.rawNode, null, 2)}
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
              <div className="empty" style={{ padding: '2rem 1rem' }}>Select a node to view detailed properties.</div>
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}
