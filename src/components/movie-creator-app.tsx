"use client";

import type { RefObject } from "react";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import Image from "next/image";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Flex,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconArrowsShuffle,
  IconFolderOpen,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconSparkles,
  IconTrash,
  IconWand,
  IconZoomIn,
} from "@tabler/icons-react";
import type {
  FrameVersion,
  FrameView,
  ProjectSnapshot,
  ReorderImpactSummary,
  TransitionVersion,
  TransitionView,
} from "@/lib/types";
import {
  getFrameCardMeta,
  getFrameGenerationDraft,
  getFrameLabel,
  getSequenceNextStep,
  getSequenceOverviewStats,
  getTransitionCardMeta,
  getTransitionDisplayPrompt,
  getTransitionLabel,
} from "@/components/movie-creator-app.helpers";

type ApiResult = ProjectSnapshot & {
  impact?: ReorderImpactSummary;
};

type ZoomTarget = {
  src: string;
  alt: string;
  title: string;
};

type MoviePlaylistEntry = {
  clipId: string;
  transitionId: string;
  label: string;
  src: string;
  posterSrc: string | undefined;
  model: string;
};

type MovieCreatorAppProps = {
  initialSnapshot?: ProjectSnapshot | null;
  initialProjectPath?: string;
};

const DEFAULT_PROJECT_PATH = process.env.NEXT_PUBLIC_DEFAULT_PROJECT_PATH?.trim() ?? "";
const PROJECT_PATH_PLACEHOLDER =
  process.env.NEXT_PUBLIC_DEFAULT_PROJECT_PATH ?? "/Users/tsilva/Desktop/moviegen";
const WORKSPACE_HEIGHT = "calc(100dvh - 32px)";
const GALLERY_ADD_TILE_ID = "__add__";
const ENTRY_PREVIEW_WIDTH = 180;

function assetUrl(relativePath: string | null | undefined) {
  if (!relativePath) {
    return "";
  }

  return `/api/assets?path=${encodeURIComponent(relativePath)}`;
}

type InlinePromptInputProps = {
  value: string;
  placeholder: string;
  name: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onFocus: () => void;
  onCommit: (value: string) => void;
};

function InlinePromptInput({
  value,
  placeholder,
  name,
  autoFocus = false,
  onChange,
  onFocus,
  onCommit,
}: InlinePromptInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }

    inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onFocus={onFocus}
      onBlur={(event) => onCommit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      name={name}
      autoComplete="off"
      variant="unstyled"
      onClick={(event) => event.stopPropagation()}
      styles={{
        input: {
          fontSize: "1rem",
          fontWeight: 600,
          lineHeight: 1.35,
          color: "white",
          padding: 0,
          minHeight: "auto",
          height: "auto",
          textOverflow: "ellipsis",
        },
      }}
    />
  );
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data as T;
}

function getInitialSelection(snapshot: ProjectSnapshot | null) {
  if (!snapshot) {
    return {
      selectedFrameId: null,
      selectedTransitionId: null,
    };
  }

  const selectedFrameId = snapshot.frames.some((frame) => frame.id === snapshot.manifest.ui.selectedFrameId)
    ? snapshot.manifest.ui.selectedFrameId
    : null;
  const selectedTransitionId = snapshot.transitions.some(
    (transition) => transition.id === snapshot.manifest.ui.selectedTransitionId,
  )
    ? snapshot.manifest.ui.selectedTransitionId
    : null;

  if (selectedTransitionId) {
    return {
      selectedFrameId: null,
      selectedTransitionId,
    };
  }

  if (selectedFrameId) {
    return {
      selectedFrameId,
      selectedTransitionId: null,
    };
  }

  return {
    selectedFrameId: snapshot.frames[0]?.id ?? null,
    selectedTransitionId: null,
  };
}

type ZoomableThumbProps = {
  src: string | null | undefined;
  zoomSrc: string | null | undefined;
  alt: string;
  emptyLabel: string;
  width: number;
  onZoom: (target: ZoomTarget) => void;
};

function ZoomableThumb({ src, zoomSrc, alt, emptyLabel, width, onZoom }: ZoomableThumbProps) {
  const previewSrc = src ? assetUrl(src) : "";
  const expandedSrc = zoomSrc ? assetUrl(zoomSrc) : previewSrc;

  return (
    <Box style={{ width, flex: `0 0 ${width}px` }}>
      <Box
        role={previewSrc ? "button" : undefined}
        tabIndex={previewSrc ? 0 : -1}
        aria-label={previewSrc ? `Zoom ${alt}` : undefined}
        onClick={
          previewSrc
            ? (event) => {
                event.stopPropagation();
                onZoom({ src: expandedSrc, alt, title: alt });
              }
            : undefined
        }
        onKeyDown={
          previewSrc
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onZoom({ src: expandedSrc, alt, title: alt });
                }
              }
            : undefined
        }
        style={{
          aspectRatio: "16 / 9",
          width: "100%",
          borderRadius: 14,
          overflow: "hidden",
          position: "relative",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          cursor: previewSrc ? "zoom-in" : "default",
        }}
      >
        {previewSrc ? (
          <>
            <Image
              src={previewSrc}
              alt={alt}
              fill
              unoptimized
              sizes={`${width}px`}
              style={{ objectFit: "cover", display: "block" }}
            />
            <Group
              gap={4}
              style={{
                position: "absolute",
                right: 8,
                bottom: 8,
                padding: "4px 6px",
                borderRadius: 999,
                background: "rgba(8, 12, 18, 0.72)",
                color: "white",
                pointerEvents: "none",
              }}
            >
              <IconZoomIn size={12} aria-hidden="true" />
              <Text size="xs" fw={600}>
                Zoom
              </Text>
            </Group>
          </>
        ) : (
          <Flex h="100%" align="center" justify="center">
            <Text c="dimmed" size="sm">
              {emptyLabel}
            </Text>
          </Flex>
        )}
      </Box>
    </Box>
  );
}

type AssetGalleryProps<TVersion extends FrameVersion | TransitionVersion> = {
  title: string;
  versions: TVersion[];
  selectedTileId: string;
  pending: boolean;
  kind: "frame" | "transition";
  getVersionLabel?: (version: TVersion) => string;
  addTileDisabled?: boolean;
  addTileDescription?: string;
  onSelectAdd: () => void;
  onSelectVersion: (versionId: string) => void;
};

function AssetGallery<TVersion extends FrameVersion | TransitionVersion>({
  title,
  versions,
  selectedTileId,
  pending,
  kind,
  getVersionLabel,
  addTileDisabled = false,
  addTileDescription,
  onSelectAdd,
  onSelectVersion,
}: AssetGalleryProps<TVersion>) {
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text fw={600} size="sm">
          {title}
        </Text>
        <Text c="dimmed" size="xs">
          {versions.length} compatible {kind === "frame" ? "asset" : "clip"}
          {versions.length === 1 ? "" : "s"}
        </Text>
      </Group>
      <Group gap="sm" align="stretch">
        <UnstyledButton
          disabled={addTileDisabled}
          onClick={onSelectAdd}
          style={{
            display: "block",
            width: ENTRY_PREVIEW_WIDTH,
            flex: `0 0 ${ENTRY_PREVIEW_WIDTH}px`,
            borderRadius: 16,
            border:
              selectedTileId === GALLERY_ADD_TILE_ID
                ? "1px solid rgba(78, 201, 240, 0.72)"
                : "1px solid rgba(255,255,255,0.08)",
            background: selectedTileId === GALLERY_ADD_TILE_ID ? "rgba(30, 70, 92, 0.36)" : "rgba(255,255,255,0.02)",
            overflow: "hidden",
            opacity: addTileDisabled ? 0.6 : 1,
            cursor: addTileDisabled ? "not-allowed" : "pointer",
          }}
        >
          <Flex
            direction="column"
            align="center"
            justify="center"
            gap="xs"
            style={{ aspectRatio: "16 / 9", padding: 16 }}
          >
            {pending ? <Loader size="sm" color="cyan" /> : <IconPlus size={24} aria-hidden="true" />}
            <Text fw={600} size="sm">
              {pending ? "Generating" : "Add Asset"}
            </Text>
            <Text c="dimmed" size="xs" ta="center">
              {pending
                ? "Waiting for output"
                : addTileDescription ?? (kind === "frame" ? "Generate a new frame" : "Generate a new clip")}
            </Text>
          </Flex>
        </UnstyledButton>

        {versions.map((version) => {
          const isSelected = selectedTileId === version.id;

          return (
            <UnstyledButton
              key={version.id}
              onClick={() => onSelectVersion(version.id)}
              style={{
                display: "block",
                width: ENTRY_PREVIEW_WIDTH,
                flex: `0 0 ${ENTRY_PREVIEW_WIDTH}px`,
                borderRadius: 16,
                border: isSelected ? "1px solid rgba(94, 230, 176, 0.72)" : "1px solid rgba(255,255,255,0.08)",
                background: isSelected ? "rgba(28, 84, 67, 0.3)" : "rgba(255,255,255,0.02)",
                overflow: "hidden",
              }}
            >
              <Stack gap="xs" p="xs">
                <Box
                  style={{
                    aspectRatio: "16 / 9",
                    overflow: "hidden",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.04)",
                    position: "relative",
                  }}
                >
                  {"thumbnailPath" in version ? (
                    <Image
                      src={assetUrl(version.thumbnailPath)}
                      alt={`Generated ${kind}`}
                      fill
                      unoptimized
                      sizes="220px"
                      style={{ objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <video
                      muted
                      loop
                      autoPlay
                      playsInline
                      preload="metadata"
                      poster={assetUrl(version.posterPath) || undefined}
                      src={assetUrl(version.outputPath)}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  )}
                </Box>
                <Text c="dimmed" size="xs" truncate>
                  {getVersionLabel?.(version) ?? version.model}
                </Text>
              </Stack>
            </UnstyledButton>
          );
        })}
      </Group>
    </Stack>
  );
}

type FrameQueueCardProps = {
  frame: FrameView;
  selected: boolean;
  reorderMode: boolean;
  selectedGalleryTileId: string;
  onSelect: () => void;
  onDelete: () => void;
  onZoom: (target: ZoomTarget) => void;
  onSelectGalleryAdd: () => void;
  onApproveVersion: (versionId: string) => void;
  onPrimaryAction: () => void;
  cardRef: (node: HTMLDivElement | null) => void;
};

function FrameQueueCard({
  frame,
  selected,
  reorderMode,
  selectedGalleryTileId,
  onSelect,
  onDelete,
  onZoom,
  onSelectGalleryAdd,
  onApproveVersion,
  onPrimaryAction,
  cardRef,
}: FrameQueueCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: frame.id,
  });
  const previewVersion = frame.currentVersion ?? frame.approvedVersion ?? frame.latestVersion;
  const isPending = frame.status === "queued" || frame.status === "generating";
  const meta = getFrameCardMeta(frame, selectedGalleryTileId);
  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    cardRef(node);
  };

  return (
    <Card
      ref={setRefs}
      withBorder
      radius="xl"
      p="md"
      onClick={onSelect}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        cursor: "pointer",
        background: selected ? "rgba(18, 24, 33, 0.96)" : "rgba(13, 18, 25, 0.9)",
        borderColor: selected ? "rgba(78, 201, 240, 0.6)" : "rgba(84, 96, 112, 0.28)",
        boxShadow: isDragging ? "0 12px 30px rgba(0,0,0,0.3)" : undefined,
      }}
    >
      <Stack gap="md">
        <Group align="flex-start" wrap="nowrap" gap="md">
          <Box style={{ position: "relative" }}>
            <ZoomableThumb
              src={previewVersion?.thumbnailPath}
              zoomSrc={previewVersion?.outputPath}
              alt={getFrameLabel(frame)}
              emptyLabel={frame.status === "queued" || frame.status === "generating" ? "Preparing…" : "No image"}
              width={ENTRY_PREVIEW_WIDTH}
              onZoom={onZoom}
            />
            {frame.status === "queued" || frame.status === "generating" ? (
              <Flex
                direction="column"
                gap={4}
                align="center"
                justify="center"
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 14,
                  background: "rgba(6, 10, 16, 0.48)",
                  backdropFilter: "blur(2px)",
                }}
              >
                <Loader size="sm" color="cyan" />
                <Text c="white" fw={600} size="xs">
                  {frame.status === "queued" ? "Queued" : "Generating"}
                </Text>
              </Flex>
            ) : null}
          </Box>

          <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Badge color={meta.statusColor}>{meta.statusLabel}</Badge>
              <Group gap="xs">
                {reorderMode ? (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`Drag ${getFrameLabel(frame)}`}
                    {...attributes}
                    {...listeners}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <IconArrowsShuffle size={16} aria-hidden="true" />
                  </ActionIcon>
                ) : null}
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={`Delete ${getFrameLabel(frame)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete();
                  }}
                >
                  <IconTrash size={16} aria-hidden="true" />
                </ActionIcon>
              </Group>
            </Group>

            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text fw={700}>{meta.title}</Text>
                <Text c={meta.promptPlaceholder ? "dimmed" : undefined} size="sm" lineClamp={2}>
                  {meta.prompt}
                </Text>
              </Stack>
              {meta.action ? (
                <Button
                  variant={meta.action.intent === "review" ? "light" : "filled"}
                  color={meta.action.color}
                  size="xs"
                  disabled={meta.action.disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    onPrimaryAction();
                  }}
                >
                  {meta.action.label}
                </Button>
              ) : null}
            </Group>

            <Text c="dimmed" size="sm">
              {meta.summary}
            </Text>
          </Stack>
        </Group>

        {selected ? (
          <>
            <Divider color="rgba(255,255,255,0.08)" />
            <Stack gap="md" onClick={(event) => event.stopPropagation()}>
              <AssetGallery
                title="Asset Gallery"
                versions={frame.galleryVersions}
                selectedTileId={selectedGalleryTileId}
                pending={isPending}
                kind="frame"
                getVersionLabel={(version) => version.sourcePrompt?.trim() || "No frame prompt yet"}
                addTileDisabled={isPending}
                onSelectAdd={onSelectGalleryAdd}
                onSelectVersion={onApproveVersion}
              />
            </Stack>
          </>
        ) : null}
      </Stack>
    </Card>
  );
}

type TransitionQueueCardProps = {
  transition: TransitionView;
  selected: boolean;
  reorderMode: boolean;
  promptValue: string;
  selectedGalleryTileId: string;
  promptAutoFocus: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onMovePair: () => void;
  onPromptChange: (value: string) => void;
  onPromptFocus: () => void;
  onPromptCommit: (value: string) => void;
  onGenerateFromGallery: () => void;
  onApproveVersion: (versionId: string) => void;
  onPrimaryAction: () => void;
  cardRef: (node: HTMLDivElement | null) => void;
};

function TransitionQueueCard({
  transition,
  selected,
  reorderMode,
  promptValue,
  selectedGalleryTileId,
  promptAutoFocus,
  isPlaying,
  onSelect,
  onDelete,
  onMovePair,
  onPromptChange,
  onPromptFocus,
  onPromptCommit,
  onGenerateFromGallery,
  onApproveVersion,
  onPrimaryAction,
  cardRef,
}: TransitionQueueCardProps) {
  const previewVideo = transition.currentVideo ?? transition.approvedVideoVersion ?? transition.latestVideoVersion;
  const isPending = transition.videoStatus === "queued" || transition.videoStatus === "generating";
  const meta = getTransitionCardMeta(transition);
  const canGenerate =
    !isPending &&
    transition.blockedByFrameIds.length === 0 &&
    transition.transitionPrompt.trim().length > 0;
  const generateDisabledReason = transition.blockedByFrameIds.length
    ? transition.disabledReason ?? "Waiting on adjacent frames."
    : transition.transitionPrompt.trim()
      ? null
      : "Add a transition prompt before generating a clip.";
  const statusLabel = isPlaying ? "Playing" : meta.statusLabel;
  const statusColor = isPlaying ? "teal" : meta.statusColor;
  const summary = isPlaying ? "This clip is currently loaded in the preview player." : meta.summary;
  const action = isPlaying
    ? { intent: "pending" as const, label: "Playing", color: "blue" as const, disabled: true }
    : meta.action;

  return (
    <Card
      ref={cardRef}
      withBorder
      radius="xl"
      p="md"
      onClick={onSelect}
      style={{
        cursor: "pointer",
        background: selected ? "rgba(17, 23, 31, 0.96)" : "rgba(11, 16, 23, 0.88)",
        borderColor: selected ? "rgba(113, 221, 181, 0.5)" : "rgba(84, 96, 112, 0.24)",
      }}
    >
      <Stack gap="md">
        <Group align="flex-start" wrap="nowrap" gap="md">
          {previewVideo ? (
            <Box
              style={{
                width: 220,
                flex: "0 0 220px",
                aspectRatio: "16 / 9",
                overflow: "hidden",
                borderRadius: 14,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <video
                muted
                loop
                autoPlay
                playsInline
                preload="metadata"
                poster={assetUrl(previewVideo.posterPath) || undefined}
                src={assetUrl(previewVideo.outputPath)}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onClick={(event) => event.stopPropagation()}
              />
            </Box>
          ) : (
            <Box
              style={{
                width: 220,
                flex: "0 0 220px",
                aspectRatio: "16 / 9",
                overflow: "hidden",
                borderRadius: 14,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <Flex h="100%" align="center" justify="center">
                <Text c="dimmed" size="sm">
                  {isPending ? "Generating movie..." : "Movie pending"}
                </Text>
              </Flex>
            </Box>
          )}

          <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Badge color={statusColor}>{statusLabel}</Badge>
              <Group gap="xs">
                {reorderMode ? (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`Move ${getTransitionLabel(transition)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMovePair();
                    }}
                  >
                    <IconArrowsShuffle size={16} aria-hidden="true" />
                  </ActionIcon>
                ) : null}
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={`Delete ${getTransitionLabel(transition)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete();
                  }}
                >
                  <IconTrash size={16} aria-hidden="true" />
                </ActionIcon>
              </Group>
            </Group>

            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text fw={700}>{meta.title}</Text>
                {selected ? (
                  <InlinePromptInput
                    value={promptValue}
                    onChange={onPromptChange}
                    onFocus={onPromptFocus}
                    onCommit={onPromptCommit}
                    placeholder="No transition prompt yet"
                    name={`transition-prompt-${transition.id}`}
                    autoFocus={promptAutoFocus}
                  />
                ) : (
                  <Text c={meta.promptPlaceholder ? "dimmed" : undefined} size="sm" lineClamp={2}>
                    {meta.prompt}
                  </Text>
                )}
              </Stack>
              {action ? (
                <Button
                  variant={action.intent === "review" ? "light" : "filled"}
                  color={action.color}
                  size="xs"
                  disabled={action.disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    onPrimaryAction();
                  }}
                >
                  {action.label}
                </Button>
              ) : null}
            </Group>

            <Text c="dimmed" size="sm">
              {summary}
            </Text>
          </Stack>
        </Group>

        {selected ? (
          <>
            <Divider color="rgba(255,255,255,0.08)" />
            <Stack gap="md" onClick={(event) => event.stopPropagation()}>
              <AssetGallery
                title="Clip Gallery"
                versions={transition.galleryVersions}
                selectedTileId={selectedGalleryTileId}
                pending={isPending}
                kind="transition"
                getVersionLabel={() => getTransitionDisplayPrompt(transition)}
                addTileDisabled={!canGenerate}
                addTileDescription={generateDisabledReason ?? undefined}
                onSelectAdd={onGenerateFromGallery}
                onSelectVersion={onApproveVersion}
              />
            </Stack>
          </>
        ) : null}
      </Stack>
    </Card>
  );
}

type ZoomModalProps = {
  target: ZoomTarget | null;
  onClose: () => void;
};

function ZoomModal({ target, onClose }: ZoomModalProps) {
  if (!target) {
    return null;
  }

  return (
    <Modal opened onClose={onClose} size="90vw" centered title={target.title}>
      <Box
        style={{
          position: "relative",
          width: "100%",
          maxHeight: "80dvh",
          aspectRatio: "16 / 9",
          overflow: "hidden",
          borderRadius: 12,
          background: "rgba(255,255,255,0.04)",
        }}
      >
        <Image
          src={target.src}
          alt={target.alt}
          fill
          unoptimized
          sizes="90vw"
          style={{ objectFit: "contain", display: "block" }}
        />
      </Box>
    </Modal>
  );
}

type AddFrameSeparatorProps = {
  label: string;
  onClick: () => void;
};

function AddFrameSeparator({ label, onClick }: AddFrameSeparatorProps) {
  return (
    <UnstyledButton
      aria-label={label}
      onClick={onClick}
      style={{ display: "block", width: "100%", padding: "4px 0" }}
    >
      <Group gap="sm" wrap="nowrap">
        <Box
          style={{
            flex: 1,
            height: 1,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.16), rgba(255,255,255,0))",
          }}
        />
        <Box
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.03)",
            color: "rgba(255,255,255,0.72)",
          }}
        >
          <IconPlus size={14} aria-hidden="true" />
        </Box>
        <Box
          style={{
            flex: 1,
            height: 1,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.16), rgba(255,255,255,0))",
          }}
        />
      </Group>
    </UnstyledButton>
  );
}

type SequenceOverviewProps = {
  currentClipCount: number;
  totalTransitionCount: number;
  missingInputCount: number;
  actionableGenerationCount: number;
  inProgressCount: number;
  nextStepTitle: string;
  nextStepDescription: string;
  nextStepCtaLabel: string | null;
  activeMovieClip: MoviePlaylistEntry | null;
  movieIndex: number;
  moviePlaylist: MoviePlaylistEntry[];
  movieIsPlaying: boolean;
  missingMovieTransitions: TransitionView[];
  movieVideoRef: RefObject<HTMLVideoElement | null>;
  onTogglePlayback: () => void;
  onSelectMovieClip: (index: number) => void;
  onNextStep: () => void;
  onLoadedData: () => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
};

function SequenceOverview({
  currentClipCount,
  totalTransitionCount,
  missingInputCount,
  actionableGenerationCount,
  inProgressCount,
  nextStepTitle,
  nextStepDescription,
  nextStepCtaLabel,
  activeMovieClip,
  movieIndex,
  moviePlaylist,
  movieIsPlaying,
  missingMovieTransitions,
  movieVideoRef,
  onTogglePlayback,
  onSelectMovieClip,
  onNextStep,
  onLoadedData,
  onPlay,
  onPause,
  onEnded,
}: SequenceOverviewProps) {
  return (
    <Card
      withBorder
      radius="xl"
      p="md"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "rgba(10, 16, 24, 0.92)",
        backdropFilter: "blur(18px)",
        borderColor: "rgba(84, 96, 112, 0.32)",
      }}
    >
      <Stack gap="md">
        <Flex gap="lg" wrap="wrap" align="stretch">
          <Stack gap="md" style={{ flex: "1 1 360px", minWidth: 0 }}>
            <Stack gap={4}>
              <Title order={4}>Sequence Overview</Title>
              <Text c="dimmed" size="sm">
                Keep the current cut in view, see what is blocked, and take the next useful step without leaving the sequence.
              </Text>
            </Stack>

            <Group gap="sm" align="stretch">
              {[
                {
                  label: "Current Cut",
                  value: `${currentClipCount}/${totalTransitionCount}`,
                  description: totalTransitionCount === 1 ? "clip ready" : "clips ready",
                },
                {
                  label: "Missing Input",
                  value: String(missingInputCount),
                  description: missingInputCount === 1 ? "prompt to add" : "prompts to add",
                },
                {
                  label: "Ready To Generate",
                  value: String(actionableGenerationCount),
                  description: actionableGenerationCount === 1 ? "item waiting" : "items waiting",
                },
                {
                  label: "In Progress",
                  value: String(inProgressCount),
                  description: inProgressCount === 1 ? "job running" : "jobs running",
                },
              ].map((stat) => (
                <Box
                  key={stat.label}
                  style={{
                    flex: "1 1 120px",
                    minWidth: 120,
                    padding: 12,
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
                    {stat.label}
                  </Text>
                  <Text fw={700} size="lg">
                    {stat.value}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {stat.description}
                  </Text>
                </Box>
              ))}
            </Group>

            <Box
              style={{
                padding: 14,
                borderRadius: 16,
                border: "1px solid rgba(78, 201, 240, 0.22)",
                background: "rgba(26, 38, 51, 0.48)",
              }}
            >
              <Group justify="space-between" align="flex-start" gap="md" wrap="nowrap">
                <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                  <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
                    Next Up
                  </Text>
                  <Text fw={700}>{nextStepTitle}</Text>
                  <Text c="dimmed" size="sm">
                    {nextStepDescription}
                  </Text>
                </Stack>
                {nextStepCtaLabel ? (
                  <Button color="cyan" onClick={onNextStep}>
                    {nextStepCtaLabel}
                  </Button>
                ) : null}
              </Group>
            </Box>
          </Stack>

          <Stack gap="sm" style={{ flex: "0 1 460px", minWidth: 320 }}>
            <Group justify="space-between" align="flex-start">
              <Stack gap={2}>
                <Text fw={700}>Current Cut</Text>
                <Text c="dimmed" size="sm">
                  {missingMovieTransitions.length > 0
                    ? `${missingMovieTransitions.length} transition${missingMovieTransitions.length === 1 ? "" : "s"} still missing a current clip.`
                    : currentClipCount > 0
                      ? "The current sequence is fully playable."
                      : "Generate the first transition clip to start playback."}
                </Text>
              </Stack>
              <Group gap="xs">
                <Button
                  size="xs"
                  leftSection={
                    movieIsPlaying ? <IconPlayerPause size={14} aria-hidden="true" /> : <IconPlayerPlay size={14} aria-hidden="true" />
                  }
                  disabled={!activeMovieClip}
                  onClick={onTogglePlayback}
                >
                  {movieIsPlaying ? "Pause" : "Play"}
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => onSelectMovieClip(movieIndex - 1)}
                  disabled={!moviePlaylist.length || movieIndex === 0}
                >
                  Previous
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => onSelectMovieClip(movieIndex + 1)}
                  disabled={!moviePlaylist.length || movieIndex >= moviePlaylist.length - 1}
                >
                  Next
                </Button>
              </Group>
            </Group>

            <Box
              style={{
                borderRadius: 16,
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              {activeMovieClip ? (
                <Stack gap={0}>
                  <Box style={{ aspectRatio: "16 / 9", background: "rgba(255,255,255,0.04)" }}>
                    <video
                      key={activeMovieClip.clipId}
                      ref={movieVideoRef}
                      controls
                      playsInline
                      preload="auto"
                      poster={activeMovieClip.posterSrc}
                      src={activeMovieClip.src}
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                      onLoadedData={onLoadedData}
                      onPlay={onPlay}
                      onPause={onPause}
                      onEnded={onEnded}
                    />
                  </Box>
                  <Box p="sm">
                    <Text fw={700}>{activeMovieClip.label}</Text>
                    <Text c="dimmed" size="sm">
                      Clip {movieIndex + 1} of {moviePlaylist.length} · {activeMovieClip.model}
                    </Text>
                  </Box>
                </Stack>
              ) : (
                <Flex mih={220} align="center" justify="center" p="md">
                  <Text c="dimmed" size="sm">
                    No current transition clips are ready yet.
                  </Text>
                </Flex>
              )}
            </Box>
          </Stack>
        </Flex>
      </Stack>
    </Card>
  );
}

export function MovieCreatorApp({
  initialSnapshot = null,
  initialProjectPath = DEFAULT_PROJECT_PATH,
}: MovieCreatorAppProps) {
  const initialSelection = getInitialSelection(initialSnapshot);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(initialSnapshot);
  const [projectPath, setProjectPath] = useState(initialProjectPath);
  const [bulkInput, setBulkInput] = useState("");
  const [zoomTarget, setZoomTarget] = useState<ZoomTarget | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(initialSelection.selectedFrameId);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(
    initialSelection.selectedTransitionId,
  );
  const [segmentMoveTarget, setSegmentMoveTarget] = useState<TransitionView | null>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkInsertIndex, setBulkInsertIndex] = useState<number | null>(null);
  const [frameGenerationTargetId, setFrameGenerationTargetId] = useState<string | null>(null);
  const [frameGenerationPromptDraft, setFrameGenerationPromptDraft] = useState("");
  const [frameGenerationUsePreviousDraft, setFrameGenerationUsePreviousDraft] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [activeEditor, setActiveEditor] = useState<null | "transitionPrompt">(null);
  const [transitionPromptDraft, setTransitionPromptDraft] = useState("");
  const [gallerySelection, setGallerySelection] = useState<Record<string, string>>({});
  const [movieCursor, setMovieCursor] = useState(0);
  const [moviePlaying, setMoviePlaying] = useState(false);
  const [isPending, startTransition] = useTransition();
  const previousPendingByEntryRef = useRef<Record<string, boolean>>({});
  const movieVideoRef = useRef<HTMLVideoElement | null>(null);
  const frameCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const transitionCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const normalizedProjectPath = projectPath.trim();

  function galleryKey(kind: "frame" | "transition", id: string) {
    return `${kind}:${id}`;
  }

  function getDefaultGalleryTileId(entry: FrameView | TransitionView) {
    return "currentVersion" in entry
      ? entry.currentVersion?.id ?? GALLERY_ADD_TILE_ID
      : entry.currentVideo?.id ?? GALLERY_ADD_TILE_ID;
  }

  function getSelectedGalleryTileId(entry: FrameView | TransitionView) {
    return gallerySelection[galleryKey("currentVersion" in entry ? "frame" : "transition", entry.id)]
      ?? getDefaultGalleryTileId(entry);
  }

  function setSelectedGalleryTile(kind: "frame" | "transition", id: string, tileId: string) {
    setGallerySelection((current) => ({
      ...current,
      [galleryKey(kind, id)]: tileId,
    }));
  }

  async function loadProject(pathValue: string, options?: { notify?: boolean }) {
    const nextProjectPath = pathValue.trim();
    const shouldNotify = options?.notify ?? true;

    if (!nextProjectPath) {
      if (shouldNotify) {
        notifications.show({ color: "yellow", message: "Enter a local project path first" });
      }
      return;
    }

    try {
      const result = await requestJson<ProjectSnapshot>("/api/project/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: nextProjectPath, createIfMissing: true }),
      });
      const nextSelection = getInitialSelection(result);
      setSnapshot(result);
      setProjectPath(result.projectPath);
      setSelectedFrameId(nextSelection.selectedFrameId);
      setSelectedTransitionId(nextSelection.selectedTransitionId);
      setGallerySelection({});
      previousPendingByEntryRef.current = {};
      setMovieCursor(0);
      setMoviePlaying(false);
      movieVideoRef.current?.pause();
      setBulkInput("");
      setBulkModalOpen(false);
      setBulkInsertIndex(null);
      setFrameGenerationTargetId(null);
      setFrameGenerationPromptDraft("");
      setFrameGenerationUsePreviousDraft(false);
      setTransitionPromptDraft(
        result.transitions.find((transition) => transition.id === nextSelection.selectedTransitionId)?.transitionPrompt ?? "",
      );
      setActiveEditor(null);
      setProjectModalOpen(false);
      if (shouldNotify) {
        notifications.show({ color: "teal", message: `Opened ${result.projectPath}` });
      }
    } catch (error) {
      if (shouldNotify) {
        notifications.show({ color: "red", message: error instanceof Error ? error.message : "Open failed" });
      }
    }
  }

  const loadProjectEffect = useEffectEvent((pathValue: string) => {
    void loadProject(pathValue, { notify: false });
  });

  useEffect(() => {
    if (!snapshot && normalizedProjectPath) {
      loadProjectEffect(normalizedProjectPath);
    }
  }, [normalizedProjectPath, snapshot]);

  async function refreshProject() {
    try {
      const result = await requestJson<ProjectSnapshot>("/api/project");
      setSnapshot(result);
    } catch (error) {
      notifications.show({ color: "red", message: error instanceof Error ? error.message : "Refresh failed" });
    }
  }

  useEffect(() => {
    if (activeEditor || frameGenerationTargetId) {
      return;
    }

    const hasActiveJobs = snapshot?.manifest.jobs.some((job) => job.status === "queued" || job.status === "running");
    if (!hasActiveJobs) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshProject();
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeEditor, frameGenerationTargetId, snapshot?.manifest.jobs]);

  useEffect(() => {
    if (!snapshot) {
      previousPendingByEntryRef.current = {};
      return;
    }

    const nextPendingByEntry: Record<string, boolean> = {};
    const nextEntryKeys = new Set<string>();

    setGallerySelection((current) => {
      let changed = false;
      const nextSelection = { ...current };

      for (const frame of snapshot.frames) {
        const key = galleryKey("frame", frame.id);
        const isPending = frame.status === "queued" || frame.status === "generating";
        const validTileIds = new Set([GALLERY_ADD_TILE_ID, ...frame.galleryVersions.map((version) => version.id)]);
        const defaultTileId = getDefaultGalleryTileId(frame);
        const selectedTileId = nextSelection[key];

        nextEntryKeys.add(key);
        nextPendingByEntry[key] = isPending;

        if (selectedTileId && !validTileIds.has(selectedTileId)) {
          nextSelection[key] = defaultTileId;
          changed = true;
          continue;
        }

        if (
          previousPendingByEntryRef.current[key] &&
          !isPending &&
          selectedTileId === GALLERY_ADD_TILE_ID &&
          defaultTileId !== GALLERY_ADD_TILE_ID
        ) {
          nextSelection[key] = defaultTileId;
          changed = true;
        }
      }

      for (const transition of snapshot.transitions) {
        const key = galleryKey("transition", transition.id);
        const isPending = transition.videoStatus === "queued" || transition.videoStatus === "generating";
        const validTileIds = new Set([GALLERY_ADD_TILE_ID, ...transition.galleryVersions.map((version) => version.id)]);
        const defaultTileId = getDefaultGalleryTileId(transition);
        const selectedTileId = nextSelection[key];

        nextEntryKeys.add(key);
        nextPendingByEntry[key] = isPending;

        if (selectedTileId && !validTileIds.has(selectedTileId)) {
          nextSelection[key] = defaultTileId;
          changed = true;
          continue;
        }

        if (
          previousPendingByEntryRef.current[key] &&
          !isPending &&
          selectedTileId === GALLERY_ADD_TILE_ID &&
          defaultTileId !== GALLERY_ADD_TILE_ID
        ) {
          nextSelection[key] = defaultTileId;
          changed = true;
        }
      }

      for (const key of Object.keys(nextSelection)) {
        if (!nextEntryKeys.has(key)) {
          delete nextSelection[key];
          changed = true;
        }
      }

      return changed ? nextSelection : current;
    });

    previousPendingByEntryRef.current = nextPendingByEntry;
  }, [snapshot]);

  const frames = snapshot?.frames ?? [];
  const transitions = snapshot?.transitions ?? [];
  const frameGenerationTarget = frames.find((frame) => frame.id === frameGenerationTargetId) ?? null;
  const transitionMap = new Map(transitions.map((transition) => [transition.fromFrameId, transition]));
  const moviePlaylist: MoviePlaylistEntry[] = transitions.flatMap((transition) => {
    if (!transition.currentVideo) {
      return [];
    }

    return [
      {
        clipId: transition.currentVideo.id,
        transitionId: transition.id,
        label: getTransitionLabel(transition),
        src: assetUrl(transition.currentVideo.outputPath),
        posterSrc: assetUrl(transition.currentVideo.posterPath) || undefined,
        model: transition.currentVideo.model,
      },
    ];
  });
  const missingMovieTransitions = transitions.filter((transition) => transition.currentVideo == null);
  const movieIndex = moviePlaylist.length ? Math.min(movieCursor, moviePlaylist.length - 1) : 0;
  const activeMovieClip = moviePlaylist[movieIndex] ?? null;
  const movieIsPlaying = moviePlaying && activeMovieClip != null;
  const overviewStats = getSequenceOverviewStats(frames, transitions, moviePlaylist.length);
  const nextStep = getSequenceNextStep(frames, transitions, moviePlaylist.length);

  const visibleFrames = frames;

  useEffect(() => {
    const video = movieVideoRef.current;
    if (!video) {
      return;
    }

    video.currentTime = 0;

    if (movieIsPlaying) {
      void video.play().catch(() => {
        setMoviePlaying(false);
      });
      return;
    }

    video.pause();
  }, [activeMovieClip?.clipId, movieIsPlaying]);

  async function mutate<T extends ApiResult>(url: string, init: RequestInit, successMessage?: string) {
    try {
      const result = await requestJson<T>(url, init);
      setSnapshot(result);
      if (result.impact) {
        notifications.show({
          color: "cyan",
          title: "Reorder impact",
          message: `${result.impact.preservedTransitions} preserved, ${result.impact.newTransitions} new, ${result.impact.videosMarkedStale} stale`,
        });
      } else if (successMessage) {
        notifications.show({ color: "teal", message: successMessage });
      }
      return true;
    } catch (error) {
      notifications.show({ color: "red", message: error instanceof Error ? error.message : "Request failed" });
      return false;
    }
  }

  function persistUiState(update: Record<string, unknown>) {
    void requestJson<ProjectSnapshot>("/api/project/ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    })
      .then(setSnapshot)
      .catch(() => {});
  }

  useEffect(() => {
    if (!snapshot || snapshot.manifest.ui.viewMode === "sequence") {
      return;
    }

    persistUiState({ viewMode: "sequence" });
  }, [snapshot]);

  function scrollEntryIntoView(kind: "frame" | "transition", id: string) {
    requestAnimationFrame(() => {
      const node = kind === "frame" ? frameCardRefs.current[id] : transitionCardRefs.current[id];
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function selectFrame(frameId: string) {
    setSelectedFrameId(frameId);
    setSelectedTransitionId(null);
    setActiveEditor(null);
    persistUiState({ selectedFrameId: frameId, selectedTransitionId: null });
  }

  function selectTransition(transitionId: string, options?: { editPrompt?: boolean }) {
    const transition = transitions.find((item) => item.id === transitionId) ?? null;
    setSelectedTransitionId(transitionId);
    setSelectedFrameId(null);
    setTransitionPromptDraft(transition?.transitionPrompt ?? "");
    setActiveEditor(options?.editPrompt ? "transitionPrompt" : null);
    persistUiState({ selectedTransitionId: transitionId, selectedFrameId: null });
  }

  async function commitTransitionPrompt(transition: TransitionView, value: string) {
    setActiveEditor(null);
    const normalizedValue = value;
    if (normalizedValue === transition.transitionPrompt) {
      setTransitionPromptDraft(normalizedValue);
      return;
    }

    const success = await mutate(
      `/api/transitions/${transition.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transitionPrompt: normalizedValue }),
      },
      "Transition updated",
    );

    if (!success) {
      setTransitionPromptDraft(transition.transitionPrompt);
    } else {
      setTransitionPromptDraft(normalizedValue);
    }
  }

  async function approveVersion(kind: "frame" | "transition", versionId: string) {
    const url =
      kind === "frame"
        ? `/api/frame-versions/${versionId}/approve`
        : `/api/transition-versions/${versionId}/approve`;

    return mutate(url, { method: "POST" }, "Current asset updated");
  }

  async function deleteFrame(frameId: string) {
    if (!window.confirm("Delete this frame? Its asset files and connected transition files will be moved into deleted/.")) {
      return;
    }

    await mutate(`/api/frames/${frameId}/delete`, { method: "POST" }, "Frame archived to deleted/");
    if (selectedFrameId === frameId) {
      setSelectedFrameId(null);
    }
  }

  async function deleteTransition(transitionId: string) {
    if (!window.confirm("Delete this transition? Its asset files will be moved into deleted/ and a fresh blank transition will be recreated if the frames remain adjacent.")) {
      return;
    }

    await mutate(
      `/api/transitions/${transitionId}/delete`,
      { method: "POST" },
      "Transition archived to deleted/",
    );
    if (selectedTransitionId === transitionId) {
      setSelectedTransitionId(null);
    }
  }

  function openGenerateFrameModal(frame: FrameView) {
    const selectedGalleryTileId = getSelectedGalleryTileId(frame);
    const draft = getFrameGenerationDraft(frame, selectedGalleryTileId);
    setFrameGenerationTargetId(frame.id);
    setFrameGenerationPromptDraft(draft.prompt);
    setFrameGenerationUsePreviousDraft(draft.usePreviousFrameAsReference);
    setSelectedGalleryTile("frame", frame.id, GALLERY_ADD_TILE_ID);
  }

  function closeGenerateFrameModal() {
    setFrameGenerationTargetId(null);
    setFrameGenerationPromptDraft("");
    setFrameGenerationUsePreviousDraft(false);
  }

  async function generateSingleTransition(transition: TransitionView) {
    setSelectedGalleryTile("transition", transition.id, GALLERY_ADD_TILE_ID);
    await mutate(
      "/api/transitions/bulk-generate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transitionIds: [transition.id] }),
      },
      "Queued transition generation",
    );
  }

  function runFramePrimaryAction(frame: FrameView) {
    selectFrame(frame.id);
    scrollEntryIntoView("frame", frame.id);

    if (frame.nextAction === "write_prompt" || frame.nextAction === "generate" || frame.status === "error") {
      openGenerateFrameModal(frame);
    }
  }

  async function runTransitionPrimaryAction(transition: TransitionView, options?: { editPrompt?: boolean }) {
    selectTransition(transition.id, options);
    scrollEntryIntoView("transition", transition.id);

    if (options?.editPrompt || !transition.transitionPrompt.trim()) {
      return;
    }

    if (transition.nextAction === "generate") {
      await generateSingleTransition(transition);
    }
  }

  async function runNextStep() {
    if (nextStep.kind === "current_cut_ready") {
      return;
    }

    if (nextStep.kind === "frame") {
      const frame = frames.find((entry) => entry.id === nextStep.entryId);
      if (frame) {
        runFramePrimaryAction(frame);
      }
      return;
    }

    const transition = transitions.find((entry) => entry.id === nextStep.entryId);
    if (!transition) {
      return;
    }

    if (nextStep.action === "write_prompt") {
      await runTransitionPrimaryAction(transition, { editPrompt: true });
      return;
    }

    await runTransitionPrimaryAction(transition);
  }

  async function generateReady() {
    const framesNeedingGeneration = frames.filter((frame) => frame.nextAction === "generate");
    const transitionsReadyToGenerate = transitions.filter((transition) => transition.nextAction === "generate");

    if (!framesNeedingGeneration.length && !transitionsReadyToGenerate.length) {
      notifications.show({ color: "gray", message: "There is nothing ready to generate." });
      return;
    }

    for (const frame of framesNeedingGeneration) {
      setSelectedGalleryTile("frame", frame.id, GALLERY_ADD_TILE_ID);
    }

    for (const transition of transitionsReadyToGenerate) {
      setSelectedGalleryTile("transition", transition.id, GALLERY_ADD_TILE_ID);
    }

    const requests: Promise<unknown>[] = [];

    if (framesNeedingGeneration.length) {
      requests.push(
        requestJson<ProjectSnapshot>("/api/frames/bulk-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frameIds: framesNeedingGeneration.map((frame) => frame.id),
            candidateCount: 1,
          }),
        }),
      );
    }

    if (transitionsReadyToGenerate.length) {
      requests.push(
        requestJson<ProjectSnapshot>("/api/transitions/bulk-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transitionIds: transitionsReadyToGenerate.map((transition) => transition.id),
          }),
        }),
      );
    }

    const results = await Promise.allSettled(requests);
    await refreshProject();

    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => (result.reason instanceof Error ? result.reason.message : "Request failed"));

    if (errors.length) {
      notifications.show({ color: "red", message: errors.join(" ") });
      return;
    }

    notifications.show({
      color: "teal",
      message: `Queued ${framesNeedingGeneration.length} frame${framesNeedingGeneration.length === 1 ? "" : "s"} and ${transitionsReadyToGenerate.length} transition${transitionsReadyToGenerate.length === 1 ? "" : "s"}.`,
    });
  }

  async function createFramesFromBulkInput() {
    const rows = bulkInput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((imagePrompt) => ({ imagePrompt }));

    if (!rows.length) {
      notifications.show({ color: "yellow", message: "Add at least one prompt." });
      return;
    }

    const success = await mutate(
      "/api/frames/bulk-create",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, insertAtIndex: bulkInsertIndex ?? frames.length }),
      },
      `Created ${rows.length} frames`,
    );

    if (success) {
      setBulkInput("");
      setBulkModalOpen(false);
      setBulkInsertIndex(null);
    }
  }

  function openAddFramesModal(insertAtIndex: number) {
    setBulkInsertIndex(insertAtIndex);
    setBulkModalOpen(true);
  }

  function closeAddFramesModal() {
    setBulkModalOpen(false);
    setBulkInsertIndex(null);
  }

  function addFramesModalTitle() {
    if (frames.length === 0) {
      return "Add Frames";
    }

    if ((bulkInsertIndex ?? frames.length) <= 0) {
      return "Add Frames Before Frame 1";
    }

    if ((bulkInsertIndex ?? frames.length) >= frames.length) {
      return `Add Frames After Frame ${frames.length}`;
    }

    return `Add Frames Between Frame ${bulkInsertIndex} and Frame ${(bulkInsertIndex ?? 0) + 1}`;
  }

  async function submitFrameGeneration() {
    const targetFrame = frames.find((frame) => frame.id === frameGenerationTargetId) ?? null;
    if (!targetFrame) {
      return;
    }

    const prompt = frameGenerationPromptDraft.trim();
    if (!prompt) {
      notifications.show({ color: "yellow", message: "Add a frame prompt first." });
      return;
    }

    const success = await mutate(
      `/api/frames/${targetFrame.id}/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          usePreviousFrameAsReference: targetFrame.position === 0 ? false : frameGenerationUsePreviousDraft,
        }),
      },
      "Queued frame generation",
    );

    if (success) {
      closeGenerateFrameModal();
    }
  }

  function selectMovieClip(nextIndex: number) {
    if (!moviePlaylist.length) {
      return;
    }

    const boundedIndex = Math.max(0, Math.min(nextIndex, moviePlaylist.length - 1));
    setMovieCursor(boundedIndex);
  }

  function playAllTransitions() {
    if (!moviePlaylist.length) {
      return;
    }

    setMovieCursor(0);
    setMoviePlaying(true);
  }

  function toggleMoviePlayback() {
    if (!activeMovieClip) {
      return;
    }

    const video = movieVideoRef.current;

    if (movieIsPlaying) {
      video?.pause();
      setMoviePlaying(false);
      return;
    }

    if (video?.ended) {
      video.currentTime = 0;
    }

    setMoviePlaying(true);

    if (video) {
      void video.play().catch(() => {
        setMoviePlaying(false);
      });
    }
  }

  function handleActiveMovieLoadedData() {
    if (!movieIsPlaying) {
      return;
    }

    const video = movieVideoRef.current;
    if (video) {
      void video.play().catch(() => {
        setMoviePlaying(false);
      });
    }
  }

  function handleActiveMoviePause() {
    const video = movieVideoRef.current;
    if (video && !video.ended) {
      setMoviePlaying(false);
    }
  }

  function handleActiveMovieEnded() {
    if (movieIndex < moviePlaylist.length - 1) {
      setMovieCursor(movieIndex + 1);
      return;
    }

    setMoviePlaying(false);
  }

  return (
    <>
      <Box p="md" style={{ minHeight: "100dvh", overflow: "hidden" }}>
        <ScrollArea h={WORKSPACE_HEIGHT} offsetScrollbars="y" scrollbarSize={10} type="scroll">
          {!snapshot ? (
            <Flex h={WORKSPACE_HEIGHT} align="center" justify="center">
              <Card withBorder radius="xl" p="xl" maw={560}>
                <Stack gap="md">
                  <Title order={2}>Open a Local Project</Title>
                  <Text c="dimmed">
                    Moviegen stores its manifest and generated media directly inside the selected folder.
                  </Text>
                  <TextInput
                    label="Project Path"
                    value={projectPath}
                    onChange={(event) => setProjectPath(event.currentTarget.value)}
                    placeholder={PROJECT_PATH_PLACEHOLDER}
                    name="project-path"
                    autoComplete="off"
                  />
                  <Button leftSection={<IconFolderOpen size={16} aria-hidden="true" />} onClick={() => void loadProject(projectPath)}>
                    Open or Create Project
                  </Button>
                </Stack>
              </Card>
            </Flex>
          ) : (
            <Stack gap="md" pb="md">
              <Card withBorder radius="xl" p="md">
                <Group justify="space-between" align="flex-start">
                  <Box style={{ minWidth: 0 }}>
                    <Title order={3}>Movie Creator</Title>
                    <Text c="dimmed" size="sm" lineClamp={1}>
                      {snapshot.manifest.project.name} · {snapshot.projectPath}
                    </Text>
                  </Box>
                  <Group gap="xs">
                    <Button leftSection={<IconWand size={16} aria-hidden="true" />} onClick={() => void generateReady()}>
                      Generate
                    </Button>
                    <Button
                      variant="light"
                      leftSection={<IconPlayerPlay size={16} aria-hidden="true" />}
                      onClick={playAllTransitions}
                      disabled={!moviePlaylist.length}
                    >
                      Play All
                    </Button>
                    <Menu withinPortal position="bottom-end">
                      <Menu.Target>
                        <Button variant="light">Advanced</Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconFolderOpen size={14} aria-hidden="true" />}
                          onClick={() => setProjectModalOpen(true)}
                        >
                          Open Project…
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconArrowsShuffle size={14} aria-hidden="true" />}
                          onClick={() => {
                            setReorderMode(!reorderMode);
                          }}
                        >
                          {reorderMode ? "Exit Reorder Mode" : "Enter Reorder Mode"}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Group>
              </Card>

              <Group gap="sm">
                <Badge color="cyan" variant="light">
                  Sequence Workspace
                </Badge>
              </Group>

              <>
                <SequenceOverview
                  currentClipCount={overviewStats.currentClipCount}
                  totalTransitionCount={overviewStats.totalTransitionCount}
                  missingInputCount={overviewStats.missingInputCount}
                  actionableGenerationCount={overviewStats.actionableGenerationCount}
                  inProgressCount={overviewStats.inProgressCount}
                  nextStepTitle={nextStep.title}
                  nextStepDescription={nextStep.description}
                  nextStepCtaLabel={nextStep.ctaLabel}
                  activeMovieClip={activeMovieClip}
                  movieIndex={movieIndex}
                  moviePlaylist={moviePlaylist}
                  movieIsPlaying={movieIsPlaying}
                  missingMovieTransitions={missingMovieTransitions}
                  movieVideoRef={movieVideoRef}
                  onTogglePlayback={toggleMoviePlayback}
                  onSelectMovieClip={selectMovieClip}
                  onNextStep={() => void runNextStep()}
                  onLoadedData={handleActiveMovieLoadedData}
                  onPlay={() => setMoviePlaying(true)}
                  onPause={handleActiveMoviePause}
                  onEnded={handleActiveMovieEnded}
                />

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(event) => {
                      if (!reorderMode) {
                        return;
                      }

                      const { active, over } = event;
                      if (!over || active.id === over.id) {
                        return;
                      }

                      const oldIndex = frames.findIndex((frame) => frame.id === active.id);
                      const newIndex = frames.findIndex((frame) => frame.id === over.id);
                      const reordered = arrayMove(frames, oldIndex, newIndex).map((frame) => frame.id);

                      startTransition(() => {
                        void mutate(
                          "/api/frames/reorder",
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ orderedFrameIds: reordered }),
                          },
                          "Frames reordered",
                        );
                      });
                    }}
                  >
                    <SortableContext items={frames.map((frame) => frame.id)} strategy={verticalListSortingStrategy}>
                      <Stack gap="sm">
                        {frames.length === 0 ? (
                          <AddFrameSeparator label="Add frames" onClick={() => openAddFramesModal(0)} />
                        ) : null}
                        {(reorderMode ? frames : visibleFrames).map((frame) => {
                          const transition = transitionMap.get(frame.id) ?? null;
                          const selectedFrameTileId = getSelectedGalleryTileId(frame);
                          return (
                            <Stack key={frame.id} gap="sm">
                              <AddFrameSeparator
                                label={`Add frames before ${getFrameLabel(frame)}`}
                                onClick={() => openAddFramesModal(frame.position)}
                              />
                              <Stack gap="sm">
                                <FrameQueueCard
                                  frame={frame}
                                  selected={selectedFrameId === frame.id}
                                  reorderMode={reorderMode}
                                  selectedGalleryTileId={selectedFrameTileId}
                                  onSelect={() => selectFrame(frame.id)}
                                  onDelete={() => void deleteFrame(frame.id)}
                                  onZoom={setZoomTarget}
                                  onPrimaryAction={() => runFramePrimaryAction(frame)}
                                  cardRef={(node) => {
                                    frameCardRefs.current[frame.id] = node;
                                  }}
                                  onSelectGalleryAdd={() => {
                                    selectFrame(frame.id);
                                    openGenerateFrameModal(frame);
                                  }}
                                  onApproveVersion={(versionId) => {
                                    void (async () => {
                                      const success = await approveVersion("frame", versionId);
                                      if (success) {
                                        setSelectedGalleryTile("frame", frame.id, versionId);
                                      }
                                    })();
                                  }}
                                />

                                {transition ? (
                                  <TransitionQueueCard
                                    transition={transition}
                                    selected={selectedTransitionId === transition.id}
                                    reorderMode={reorderMode}
                                    promptValue={
                                      selectedTransitionId === transition.id && activeEditor === "transitionPrompt"
                                        ? transitionPromptDraft
                                        : transition.transitionPrompt
                                    }
                                    selectedGalleryTileId={getSelectedGalleryTileId(transition)}
                                    promptAutoFocus={
                                      selectedTransitionId === transition.id && activeEditor === "transitionPrompt"
                                    }
                                    isPlaying={activeMovieClip?.transitionId === transition.id}
                                    onSelect={() => selectTransition(transition.id)}
                                    onDelete={() => void deleteTransition(transition.id)}
                                    onMovePair={() => {
                                      setSegmentMoveTarget(transition);
                                      setSegmentIndex(transition.fromFrame.position + 1);
                                    }}
                                    onPrimaryAction={() => {
                                      void runTransitionPrimaryAction(
                                        transition,
                                        !transition.transitionPrompt.trim() ? { editPrompt: true } : undefined,
                                      );
                                    }}
                                    cardRef={(node) => {
                                      transitionCardRefs.current[transition.id] = node;
                                    }}
                                    onPromptChange={setTransitionPromptDraft}
                                    onPromptFocus={() => {
                                      setTransitionPromptDraft(transition.transitionPrompt);
                                      setActiveEditor("transitionPrompt");
                                    }}
                                    onPromptCommit={(value) => void commitTransitionPrompt(transition, value)}
                                    onGenerateFromGallery={() => {
                                      selectTransition(transition.id);
                                      scrollEntryIntoView("transition", transition.id);
                                      void generateSingleTransition(transition);
                                    }}
                                    onApproveVersion={(versionId) => {
                                      void (async () => {
                                        const success = await approveVersion("transition", versionId);
                                        if (success) {
                                          setSelectedGalleryTile("transition", transition.id, versionId);
                                        }
                                      })();
                                    }}
                                  />
                                ) : null}
                              </Stack>
                            </Stack>
                          );
                        })}
                        {frames.length > 0 ? (
                          <AddFrameSeparator
                            label={`Add frames after ${getFrameLabel(frames[frames.length - 1]!)}`}
                            onClick={() => openAddFramesModal(frames.length)}
                          />
                        ) : null}
                      </Stack>
                    </SortableContext>
                </DndContext>

                {isPending ? <Text c="dimmed">Applying reorder…</Text> : null}
              </>
            </Stack>
          )}
        </ScrollArea>
      </Box>

      <ZoomModal target={zoomTarget} onClose={() => setZoomTarget(null)} />

      <Modal opened={projectModalOpen} onClose={() => setProjectModalOpen(false)} title="Open Project">
        <Stack>
          <TextInput
            label="Project Path"
            value={projectPath}
            onChange={(event) => setProjectPath(event.currentTarget.value)}
            placeholder={PROJECT_PATH_PLACEHOLDER}
            name="project-path-modal"
            autoComplete="off"
          />
          <Button leftSection={<IconFolderOpen size={16} aria-hidden="true" />} onClick={() => void loadProject(projectPath)}>
            Open Project
          </Button>
        </Stack>
      </Modal>

      <Modal opened={bulkModalOpen} onClose={closeAddFramesModal} title={addFramesModalTitle()}>
        <Stack>
          <Textarea
            label="One Prompt Per Line"
            value={bulkInput}
            onChange={(event) => setBulkInput(event.currentTarget.value)}
            minRows={8}
            placeholder="Wide establishing shot…"
            name="bulk-frame-prompts"
            autoComplete="off"
          />
          <Text c="dimmed" size="sm">
            Frames with prompts start generating automatically in sequence as soon as the new chain can begin.
          </Text>
          <Button leftSection={<IconSparkles size={16} aria-hidden="true" />} onClick={() => void createFramesFromBulkInput()}>
            Create Frames
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(frameGenerationTarget)}
        onClose={closeGenerateFrameModal}
        title={frameGenerationTarget ? `Generate ${getFrameLabel(frameGenerationTarget)}` : "Generate Frame"}
      >
        <Stack>
          <Textarea
            label="Prompt"
            value={frameGenerationPromptDraft}
            onChange={(event) => setFrameGenerationPromptDraft(event.currentTarget.value)}
            minRows={6}
            placeholder="Describe the frame you want to generate…"
            name="frame-generation-prompt"
            autoComplete="off"
            autoFocus
          />
          {frameGenerationTarget && frameGenerationTarget.position > 0 ? (
            <Switch
              checked={frameGenerationUsePreviousDraft}
              onChange={(event) => setFrameGenerationUsePreviousDraft(event.currentTarget.checked)}
              label="Use Previous Frame As Reference"
            />
          ) : (
            <Text c="dimmed" size="sm">
              The first frame always generates without using a previous-frame reference.
            </Text>
          )}
          {frameGenerationTarget?.disabledReason ? (
            <Text c="dimmed" size="sm">
              {frameGenerationTarget.disabledReason}
            </Text>
          ) : null}
          <Button
            leftSection={<IconSparkles size={16} aria-hidden="true" />}
            onClick={() => void submitFrameGeneration()}
            disabled={
              !frameGenerationTarget ||
              frameGenerationTarget.status === "blocked_upstream" ||
              frameGenerationTarget.status === "queued" ||
              frameGenerationTarget.status === "generating"
            }
          >
            Generate Frame
          </Button>
        </Stack>
      </Modal>

      <Modal opened={Boolean(segmentMoveTarget)} onClose={() => setSegmentMoveTarget(null)} title="Move Segment">
        <Stack>
          <Text size="sm" c="dimmed">
            Move the selected two-frame segment to a new insertion index.
          </Text>
          <NumberInput
            min={0}
            max={Math.max(frames.length - 2, 0)}
            value={segmentIndex}
            onChange={(value) => setSegmentIndex(typeof value === "number" ? value : 0)}
          />
          <Button
            onClick={() => {
              if (!segmentMoveTarget) {
                return;
              }

              void mutate(
                "/api/segments/move",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ startFrameId: segmentMoveTarget.fromFrameId, targetIndex: segmentIndex }),
                },
                "Segment moved",
              );
              setSegmentMoveTarget(null);
            }}
          >
            Move Pair
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
