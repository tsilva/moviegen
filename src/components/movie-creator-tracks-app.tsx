"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
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
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconFolderOpen,
  IconSettings,
  IconInfoCircle,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import type {
  FrameVersion,
  FrameView,
  GenerationSettings,
  ProjectGenerationDefaults,
  ProjectSnapshot,
  TrackSlotSelection,
  TrackSlotView,
  TrackView,
  TransitionVersion,
  TransitionView,
} from "@/lib/types";
import { filterGenerationSettingsForModel } from "@/lib/generation-config";
import {
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  type GenerationModelDefinition,
  type GenerationSettingDefinition,
  getModelDefaultSettings,
  getModelDefinition,
  getModelsForAssetKind,
} from "@/lib/generation-models";
import {
  getFrameGenerationDraft,
  hasActiveGenerationJobs,
  reconcileGallerySelectionAfterSnapshot,
  getSequenceNextStep,
  getSequenceOverviewStats,
  getTransitionGenerationDraft,
  shouldApplySyncedSnapshot,
  shouldSyncEditorDraft,
} from "@/components/movie-creator-app.helpers";

type ApiResult = ProjectSnapshot & {
  impact?: unknown;
};

type AssetInfoTarget = {
  title: string;
  requestPayload: unknown;
  responsePayload: unknown;
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

type AssetGalleryProps<TVersion extends FrameVersion | TransitionVersion> = {
  title: string;
  versions: TVersion[];
  selectedTileId: string;
  pendingLabel?: string | null;
  kind: "frame" | "transition";
  getVersionLabel?: (version: TVersion) => string;
  onDropFiles?: (files: File[]) => void | Promise<void>;
  onSelectVersion: (versionId: string) => void;
  onOpenInfo: (version: TVersion) => void;
  onStopPending?: () => void | Promise<void>;
};

type SequenceOverviewProps = {
  currentClipCount: number;
  totalTransitionCount: number;
  missingInputCount: number;
  actionableGenerationCount: number;
  inProgressCount: number;
  activeMovieClip: MoviePlaylistEntry | null;
  movieIndex: number;
  moviePlaylist: MoviePlaylistEntry[];
  movieIsPlaying: boolean;
  movieVideoRef: React.RefObject<HTMLVideoElement | null>;
  onTogglePlayback: () => void;
  onSelectMovieClip: (index: number) => void;
  onLoadedData: () => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
};

const DEFAULT_PROJECT_PATH = process.env.NEXT_PUBLIC_DEFAULT_PROJECT_PATH?.trim() ?? "";
const PROJECT_PATH_PLACEHOLDER =
  process.env.NEXT_PUBLIC_DEFAULT_PROJECT_PATH ?? "/Users/tsilva/Desktop/moviegen";
const WORKSPACE_HEIGHT = "calc(100dvh - 32px)";
const GALLERY_ADD_TILE_ID = "__add__";
const ENTRY_PREVIEW_WIDTH = 180;
const PANEL_PADDING = 12;

function getDraftSettingsForModel(modelId: string, settings: GenerationSettings | null | undefined) {
  return {
    ...getModelDefaultSettings(modelId),
    ...filterGenerationSettingsForModel(modelId, settings),
  };
}

function cloneGenerationDefaults(generationDefaults: ProjectGenerationDefaults | null | undefined) {
  return structuredClone(generationDefaults?.byModel ?? {});
}

type GenerationConfigFieldsProps = {
  assetKind: "frame" | "transition";
  modelId: string;
  systemPromptTemplate: string;
  settings: GenerationSettings;
  onModelIdChange: (modelId: string) => void;
  onSystemPromptTemplateChange: (value: string) => void;
  onSettingChange: (key: string, value: string | boolean) => void;
  systemPromptLabel?: string;
};

function GenerationConfigFields({
  assetKind,
  modelId,
  systemPromptTemplate,
  settings,
  onModelIdChange,
  onSystemPromptTemplateChange,
  onSettingChange,
  systemPromptLabel = "System Prompt Template",
}: GenerationConfigFieldsProps) {
  const models = getModelsForAssetKind(assetKind);
  const definition = (getModelDefinition(modelId) ?? models[0] ?? null) as GenerationModelDefinition | null;

  return (
    <Stack gap="xs">
      <Select
        label="Model"
        value={modelId}
        data={models.map((model) => ({ value: model.id, label: model.label }))}
        allowDeselect={false}
        onChange={(value) => {
          if (value) {
            onModelIdChange(value);
          }
        }}
      />
      <Textarea
        label={systemPromptLabel}
        description={`Use ${DEFAULT_SYSTEM_PROMPT_TEMPLATE} exactly once.`}
        value={systemPromptTemplate}
        onChange={(event) => onSystemPromptTemplateChange(event.currentTarget.value)}
        minRows={2}
        autosize
        maxRows={4}
        autoComplete="off"
      />
      {definition?.settings.map((setting: GenerationSettingDefinition) => {
        if (setting.kind === "boolean") {
          return (
            <Switch
              key={setting.key}
              label={setting.label}
              checked={Boolean(settings[setting.key])}
              onChange={(event) => onSettingChange(setting.key, event.currentTarget.checked)}
            />
          );
        }

        return (
          <Select
            key={setting.key}
            label={setting.label}
            value={String(settings[setting.key] ?? setting.defaultValue)}
            data={(setting.options ?? []).map((option: { value: string; label: string }) => ({
              value: option.value,
              label: option.label,
            }))}
            allowDeselect={false}
            onChange={(value) => {
              if (value) {
                onSettingChange(setting.key, value);
              }
            }}
          />
        );
      })}
    </Stack>
  );
}

function assetUrl(relativePath: string | null | undefined) {
  if (!relativePath) {
    return "";
  }

  return `/api/assets?path=${encodeURIComponent(relativePath)}`;
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data as T;
}

function formatPayload(value: unknown) {
  if (value === undefined) {
    return "Not available for this asset.";
  }

  return JSON.stringify(value, null, 2);
}

function getSelectionFromSnapshot(snapshot: ProjectSnapshot | null): TrackSlotSelection | null {
  if (!snapshot || snapshot.tracks.length === 0) {
    return null;
  }

  const selectedSlot = snapshot.manifest.ui.selectedSlot;
  if (
    selectedSlot &&
    snapshot.tracks.some(
      (track) => track.id === selectedSlot.trackId && selectedSlot.slotKind in track.slots,
    )
  ) {
    return selectedSlot;
  }

  return {
    trackId: snapshot.tracks[0]!.id,
    slotKind: "startFrame",
  };
}

function findSelectionForEntry(
  tracks: TrackView[],
  kind: "frame" | "transition",
  entryId: string,
): TrackSlotSelection | null {
  if (kind === "transition") {
    const track = tracks.find((item) => item.transition.id === entryId);
    return track ? { trackId: track.id, slotKind: "transition" } : null;
  }

  for (const track of tracks) {
    if (track.startFrame.id === entryId) {
      return {
        trackId: track.id,
        slotKind: "startFrame",
      };
    }

    if (track.endFrame.id === entryId) {
      return {
        trackId: track.id,
        slotKind: "endFrame",
      };
    }
  }

  return null;
}

function getSlotSelectionLabel(slot: TrackSlotView) {
  switch (slot.slotKind) {
    case "startFrame":
      return "Start Frame";
    case "transition":
      return "Transition";
    case "endFrame":
      return "End Frame";
  }
}

function getTrackRangeLabel(track: TrackView) {
  return `Frames ${track.startFrame.position + 1}-${track.endFrame.position + 1}`;
}

function getCompactSlotEyebrow(slot: TrackSlotView) {
  switch (slot.slotKind) {
    case "startFrame":
      return "Start";
    case "transition":
      return "Clip";
    case "endFrame":
      return "End";
  }
}

function getCompactSlotTitle(slot: TrackSlotView) {
  if (slot.slotKind === "transition") {
    return slot.label.replace(/^Transition\s+/i, "");
  }

  return slot.label;
}

function AssetGallery<TVersion extends FrameVersion | TransitionVersion>({
  title,
  versions,
  selectedTileId,
  pendingLabel,
  kind,
  getVersionLabel,
  onDropFiles,
  onSelectVersion,
  onOpenInfo,
  onStopPending,
}: AssetGalleryProps<TVersion>) {
  const [isDropActive, setIsDropActive] = useState(false);
  const canDropFiles = kind === "frame" && onDropFiles != null;

  function containsDraggedFiles(event: React.DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  function resetDropState() {
    setIsDropActive(false);
  }

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
      <Group
        gap="sm"
        align="stretch"
        onDragEnter={
          canDropFiles
            ? (event) => {
                if (!containsDraggedFiles(event)) {
                  return;
                }

                event.preventDefault();
                setIsDropActive(true);
              }
            : undefined
        }
        onDragOver={
          canDropFiles
            ? (event) => {
                if (!containsDraggedFiles(event)) {
                  return;
                }

                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";

                if (!isDropActive) {
                  setIsDropActive(true);
                }
              }
            : undefined
        }
        onDragLeave={
          canDropFiles
            ? (event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  return;
                }

                resetDropState();
              }
            : undefined
        }
        onDrop={
          canDropFiles
            ? async (event) => {
                if (!containsDraggedFiles(event)) {
                  return;
                }

                event.preventDefault();
                resetDropState();

                const droppedFiles = Array.from(event.dataTransfer.files ?? []);
                if (!droppedFiles.length) {
                  return;
                }

                await onDropFiles?.(droppedFiles);
              }
            : undefined
        }
        style={{
          borderRadius: 16,
          outline: isDropActive ? "1px dashed rgba(94, 230, 176, 0.8)" : undefined,
          outlineOffset: 6,
        }}
      >
        {pendingLabel ? (
          <Box
            key={GALLERY_ADD_TILE_ID}
            style={{
              display: "block",
              width: ENTRY_PREVIEW_WIDTH,
              flex: `0 0 ${ENTRY_PREVIEW_WIDTH}px`,
              borderRadius: 16,
              border:
                selectedTileId === GALLERY_ADD_TILE_ID
                  ? "1px solid rgba(78, 201, 240, 0.72)"
                  : "1px solid rgba(255,255,255,0.08)",
              background:
                selectedTileId === GALLERY_ADD_TILE_ID
                  ? "rgba(30, 70, 92, 0.36)"
                  : "rgba(255,255,255,0.02)",
              overflow: "hidden",
            }}
          >
            <Stack gap="xs" p="xs">
              <Flex
                direction="column"
                align="center"
                justify="center"
                gap="xs"
                style={{
                  aspectRatio: "16 / 9",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: 16,
                }}
              >
                <Loader size="sm" color="cyan" />
                <Text fw={600} size="sm">
                  {pendingLabel}
                </Text>
                <Text c="dimmed" size="xs" ta="center">
                  {kind === "frame"
                    ? pendingLabel === "Queued"
                      ? "A new asset is queued."
                      : "A new asset is being generated."
                    : pendingLabel === "Queued"
                      ? "A new clip is queued."
                      : "A new clip is being generated."}
                </Text>
              </Flex>
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<IconPlayerStop size={14} aria-hidden="true" />}
                onClick={() => void onStopPending?.()}
              >
                Stop
              </Button>
              <Text c="dimmed" size="xs" truncate>
                {kind === "frame"
                  ? pendingLabel === "Queued"
                    ? "Waiting for asset"
                    : "Generating asset"
                  : pendingLabel === "Queued"
                    ? "Waiting for clip"
                    : "Generating clip"}
              </Text>
            </Stack>
          </Box>
        ) : null}

        {versions.map((version) => {
          const isSelected = selectedTileId === version.id;

          return (
            <Box
              key={version.id}
              role="button"
              tabIndex={0}
              aria-label={`Select ${kind === "frame" ? "asset" : "clip"} ${getVersionLabel?.(version) ?? version.model}`}
              onClick={() => onSelectVersion(version.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectVersion(version.id);
                }
              }}
              style={{
                display: "block",
                width: ENTRY_PREVIEW_WIDTH,
                flex: `0 0 ${ENTRY_PREVIEW_WIDTH}px`,
                borderRadius: 16,
                border: isSelected ? "1px solid rgba(94, 230, 176, 0.72)" : "1px solid rgba(255,255,255,0.08)",
                background: isSelected ? "rgba(28, 84, 67, 0.3)" : "rgba(255,255,255,0.02)",
                overflow: "hidden",
                cursor: "pointer",
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
                  <ActionIcon
                    variant="filled"
                    color="dark"
                    radius="xl"
                    size="sm"
                    aria-label={`Show generation request and response for ${getVersionLabel?.(version) ?? version.model}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenInfo(version);
                    }}
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      zIndex: 2,
                      background: "rgba(8, 12, 18, 0.78)",
                    }}
                  >
                    <IconInfoCircle size={14} aria-hidden="true" />
                  </ActionIcon>
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
            </Box>
          );
        })}
      </Group>
    </Stack>
  );
}

function TrackSlotTile({
  slot,
  selected,
  onSelect,
}: {
  slot: TrackSlotView;
  selected: boolean;
  onSelect: () => void;
}) {
  const previewSrc = slot.previewPath ? assetUrl(slot.previewPath) : "";
  const detailText = slot.promptPlaceholder ? slot.summary : slot.prompt;
  const compactTitle = getCompactSlotTitle(slot);
  const borderColor = selected
    ? "rgba(78, 201, 240, 0.72)"
    : slot.isStale
      ? "rgba(255, 166, 77, 0.52)"
      : "rgba(255,255,255,0.08)";
  const background = selected
    ? "rgba(26, 44, 58, 0.54)"
    : slot.isStale
      ? "rgba(82, 48, 20, 0.32)"
      : "rgba(255,255,255,0.03)";

  return (
    <UnstyledButton
      onClick={onSelect}
      style={{
        display: "block",
        flex: "1 1 160px",
        minWidth: 160,
        borderRadius: 14,
        border: `1px solid ${borderColor}`,
        background,
        overflow: "hidden",
      }}
    >
      <Stack gap={8} p={8}>
        <Box
          style={{
            aspectRatio: "16 / 5.25",
            overflow: "hidden",
            borderRadius: 8,
            position: "relative",
            background: "rgba(255,255,255,0.05)",
          }}
        >
          {previewSrc ? (
            <Image
              src={previewSrc}
              alt={slot.label}
              fill
              unoptimized
              sizes="300px"
              style={{ objectFit: "cover", display: "block" }}
            />
          ) : (
            <Flex h="100%" align="center" justify="center" p="xs">
              <Text c="dimmed" size="xs" ta="center">
                {slot.entryKind === "frame" ? "No frame yet" : "No clip yet"}
              </Text>
            </Flex>
          )}
          {(slot.statusLabel === "Queued" || slot.statusLabel === "Generating") ? (
            <Flex
              align="center"
              justify="center"
              gap={6}
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(6, 10, 16, 0.48)",
                backdropFilter: "blur(2px)",
              }}
            >
              <Loader size="sm" color="cyan" />
              <Text c="white" fw={600} size="xs">
                {slot.statusLabel}
              </Text>
            </Flex>
          ) : null}
        </Box>

        <Group justify="space-between" align="flex-start" gap={6} wrap="nowrap">
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text c="dimmed" size="10px" fw={700} tt="uppercase" lh={1.1}>
              {getCompactSlotEyebrow(slot)}
            </Text>
            <Text fw={700} size="sm" truncate>
              {compactTitle}
            </Text>
          </Stack>
          <Group gap={4} wrap="nowrap">
            <Badge color={slot.statusColor} size="sm">
              {slot.statusLabel}
            </Badge>
            {slot.isStale ? (
              <Badge color="orange" size="sm" variant="light">
                Stale
              </Badge>
            ) : null}
          </Group>
        </Group>

        <Text size="xs" lineClamp={1} c={slot.promptPlaceholder ? "dimmed" : undefined}>
          {detailText}
        </Text>

        {slot.candidateCount > 0 ? (
          <Text c="dimmed" size="10px">
            {slot.candidateCount} option{slot.candidateCount === 1 ? "" : "s"}
          </Text>
        ) : null}
      </Stack>
    </UnstyledButton>
  );
}

function TrackCard({
  track,
  selectedSlot,
  onSelectSlot,
  onDeleteTrack,
  cardRef,
}: {
  track: TrackView;
  selectedSlot: TrackSlotSelection | null;
  onSelectSlot: (selection: TrackSlotSelection) => void;
  onDeleteTrack: () => void;
  cardRef: (node: HTMLDivElement | null) => void;
}) {
  return (
    <Card
      ref={cardRef}
      withBorder
      radius="lg"
      p={PANEL_PADDING}
      style={{
        background: "rgba(13, 18, 25, 0.9)",
        borderColor: "rgba(84, 96, 112, 0.28)",
      }}
    >
      <Stack gap={10}>
        <Group justify="space-between" align="center" gap="xs" wrap="nowrap">
          <Group gap={8} wrap="nowrap">
            <Text fw={700} size="sm">
              Track {track.index + 1}
            </Text>
            <Text c="dimmed" size="xs">
              {getTrackRangeLabel(track)}
            </Text>
          </Group>
          <ActionIcon
            variant="subtle"
            color="red"
            size="sm"
            aria-label={`Delete Track ${track.index + 1}`}
            onClick={(event) => {
              event.stopPropagation();
              onDeleteTrack();
            }}
          >
            <IconTrash size={14} aria-hidden="true" />
          </ActionIcon>
        </Group>

        <Flex gap={8} wrap="wrap">
          <TrackSlotTile
            slot={track.slots.startFrame}
            selected={
              selectedSlot?.trackId === track.id &&
              selectedSlot.slotKind === "startFrame"
            }
            onSelect={() =>
              onSelectSlot({
                trackId: track.id,
                slotKind: "startFrame",
              })
            }
          />
          <TrackSlotTile
            slot={track.slots.transition}
            selected={
              selectedSlot?.trackId === track.id &&
              selectedSlot.slotKind === "transition"
            }
            onSelect={() =>
              onSelectSlot({
                trackId: track.id,
                slotKind: "transition",
              })
            }
          />
          <TrackSlotTile
            slot={track.slots.endFrame}
            selected={
              selectedSlot?.trackId === track.id &&
              selectedSlot.slotKind === "endFrame"
            }
            onSelect={() =>
              onSelectSlot({
                trackId: track.id,
                slotKind: "endFrame",
              })
            }
          />
        </Flex>
      </Stack>
    </Card>
  );
}

function AssetInfoModal({ target, onClose }: { target: AssetInfoTarget | null; onClose: () => void }) {
  if (!target) {
    return null;
  }

  return (
    <Modal opened onClose={onClose} size="min(960px, 96vw)" centered title={target.title}>
      <Stack gap="md">
        <Stack gap={6}>
          <Text fw={700} size="sm">
            Raw Request
          </Text>
          <ScrollArea.Autosize mah="28dvh" offsetScrollbars>
            <Box
              component="pre"
              m={0}
              p="sm"
              style={{
                overflow: "auto",
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {formatPayload(target.requestPayload)}
            </Box>
          </ScrollArea.Autosize>
        </Stack>

        <Stack gap={6}>
          <Text fw={700} size="sm">
            Raw Response
          </Text>
          <ScrollArea.Autosize mah="28dvh" offsetScrollbars>
            <Box
              component="pre"
              m={0}
              p="sm"
              style={{
                overflow: "auto",
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {formatPayload(target.responsePayload)}
            </Box>
          </ScrollArea.Autosize>
        </Stack>
      </Stack>
    </Modal>
  );
}

function AddTrackSeparator({ label, onClick }: { label: string; onClick: () => void }) {
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

function NextStepCard({
  title,
  description,
  ctaLabel,
  onNextStep,
}: {
  title: string;
  description: string;
  ctaLabel: string | null;
  onNextStep: () => void;
}) {
  return (
    <Box
      style={{
        padding: PANEL_PADDING,
        borderRadius: 16,
        border: "1px solid rgba(78, 201, 240, 0.22)",
        background: "rgba(26, 38, 51, 0.48)",
      }}
    >
      <Stack gap="xs">
        <Stack gap={2}>
          <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
            Next Up
          </Text>
          <Text fw={700} size="sm">
            {title}
          </Text>
          <Text c="dimmed" size="xs">
            {description}
          </Text>
        </Stack>
        {ctaLabel ? (
          <Button color="cyan" size="xs" fullWidth onClick={onNextStep}>
            {ctaLabel}
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}

function SequenceOverview({
  currentClipCount,
  totalTransitionCount,
  missingInputCount,
  actionableGenerationCount,
  inProgressCount,
  activeMovieClip,
  movieIndex,
  moviePlaylist,
  movieIsPlaying,
  movieVideoRef,
  onTogglePlayback,
  onSelectMovieClip,
  onLoadedData,
  onPlay,
  onPause,
  onEnded,
}: SequenceOverviewProps) {
  return (
    <Stack gap="sm">
      <Box
        style={{
          padding: PANEL_PADDING,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <Stack gap="xs">
          <Box
            style={{
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              boxShadow: "0 18px 40px rgba(0, 0, 0, 0.28)",
            }}
          >
            {activeMovieClip ? (
              <Stack gap={0}>
                <Box style={{ aspectRatio: "16 / 9", minHeight: 220, background: "rgba(255,255,255,0.04)" }}>
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
                  <Text fw={700} size="sm">
                    {activeMovieClip.label}
                  </Text>
                  <Text c="dimmed" size="xs">
                    Clip {movieIndex + 1} of {moviePlaylist.length} · {activeMovieClip.model}
                  </Text>
                </Box>
              </Stack>
            ) : (
              <Flex mih={220} align="center" justify="center" p="md">
                <Text c="dimmed" size="sm" ta="center">
                  No current transition clips are ready yet.
                </Text>
              </Flex>
            )}
          </Box>

          <Group gap="xs" grow>
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
              Prev
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
        </Stack>
      </Box>

      <Flex gap="xs" wrap="wrap" align="stretch">
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
            label: "Ready",
            value: String(actionableGenerationCount),
            description: actionableGenerationCount === 1 ? "item waiting" : "items waiting",
          },
          {
            label: "Running",
            value: String(inProgressCount),
            description: inProgressCount === 1 ? "job running" : "jobs running",
          },
        ].map((stat) => (
          <Box
            key={stat.label}
            style={{
              flex: "1 1 120px",
              minWidth: 120,
              padding: PANEL_PADDING,
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
      </Flex>
    </Stack>
  );
}

export function MovieCreatorApp({
  initialSnapshot = null,
  initialProjectPath = DEFAULT_PROJECT_PATH,
}: MovieCreatorAppProps) {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(initialSnapshot);
  const [projectPath, setProjectPath] = useState(initialProjectPath);
  const [assetInfoTarget, setAssetInfoTarget] = useState<AssetInfoTarget | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TrackSlotSelection | null>(getSelectionFromSnapshot(initialSnapshot));
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectSettingsModalOpen, setProjectSettingsModalOpen] = useState(false);
  const [projectGenerationDefaultsDraft, setProjectGenerationDefaultsDraft] = useState(
    () => cloneGenerationDefaults(initialSnapshot?.manifest.generationDefaults),
  );
  const [gallerySelection, setGallerySelection] = useState<Record<string, string>>({});
  const [movieCursor, setMovieCursor] = useState(0);
  const [moviePlaying, setMoviePlaying] = useState(false);
  const [framePromptDraft, setFramePromptDraft] = useState("");
  const [frameUsePreviousDraft, setFrameUsePreviousDraft] = useState(false);
  const [frameModelIdDraft, setFrameModelIdDraft] = useState("");
  const [frameSystemPromptTemplateDraft, setFrameSystemPromptTemplateDraft] = useState(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
  const [frameGenerationSettingsDraft, setFrameGenerationSettingsDraft] = useState<GenerationSettings>({});
  const [frameConfigDirty, setFrameConfigDirty] = useState(false);
  const [transitionPromptDraft, setTransitionPromptDraft] = useState("");
  const [transitionModelIdDraft, setTransitionModelIdDraft] = useState("");
  const [transitionSystemPromptTemplateDraft, setTransitionSystemPromptTemplateDraft] = useState(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
  const [transitionGenerationSettingsDraft, setTransitionGenerationSettingsDraft] = useState<GenerationSettings>({});
  const [transitionConfigDirty, setTransitionConfigDirty] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const previousPendingByEntryRef = useRef<Record<string, boolean>>({});
  const previousDefaultTileByEntryRef = useRef<Record<string, string>>({});
  const frameAutosaveRequestIdRef = useRef(0);
  const transitionAutosaveRequestIdRef = useRef(0);
  const syncedEditorEntryKeyRef = useRef<string | null>(null);
  const syncIntervalRef = useRef<number | null>(null);
  const syncRequestIdRef = useRef(0);
  const syncInFlightRef = useRef(false);
  const movieVideoRef = useRef<HTMLVideoElement | null>(null);
  const trackCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const frameReferenceInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedProjectPath = projectPath.trim();
  const snapshotProjectPath = snapshot?.projectPath ?? null;
  const projectGenerationDefaults = snapshot?.manifest.generationDefaults ?? null;

  const tracks = snapshot?.tracks ?? [];
  const frames = snapshot?.frames ?? [];
  const transitions = snapshot?.transitions ?? [];
  const selectedTrack = selectedSlot ? tracks.find((track) => track.id === selectedSlot.trackId) ?? null : null;
  const selectedSlotView = selectedTrack && selectedSlot ? selectedTrack.slots[selectedSlot.slotKind] : null;
  const selectedFrame =
    selectedTrack && selectedSlot && selectedSlotView?.entryKind === "frame"
      ? selectedSlot.slotKind === "startFrame"
        ? selectedTrack.startFrame
        : selectedTrack.endFrame
      : null;
  const selectedTransition =
    selectedTrack && selectedSlotView?.entryKind === "transition" ? selectedTrack.transition : null;
  const selectedFrameTileId = selectedFrame ? getSelectedGalleryTileId(selectedFrame) : GALLERY_ADD_TILE_ID;
  const selectedTransitionTileId = selectedTransition ? getSelectedGalleryTileId(selectedTransition) : GALLERY_ADD_TILE_ID;

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

  function openAssetInfo(kind: "frame" | "transition", version: FrameVersion | TransitionVersion) {
    setAssetInfoTarget({
      title: `${kind === "frame" ? "Frame Asset" : "Transition Clip"} Info`,
      requestPayload: version.inputPayload,
      responsePayload: version.responsePayload,
    });
  }

  function applySnapshotUpdate(result: ProjectSnapshot) {
    setSnapshot(result);
    setProjectPath(result.projectPath);
  }

  function applyProjectSnapshot(result: ProjectSnapshot, options?: { notifyMessage?: string; closeProjectModal?: boolean }) {
    applySnapshotUpdate(result);
    setSelectedSlot(getSelectionFromSnapshot(result));
    setGallerySelection({});
    previousPendingByEntryRef.current = {};
    previousDefaultTileByEntryRef.current = {};
    setMovieCursor(0);
    setMoviePlaying(false);
    movieVideoRef.current?.pause();
    setAssetInfoTarget(null);

    if (options?.closeProjectModal ?? true) {
      setProjectModalOpen(false);
    }

    if (options?.notifyMessage) {
      notifications.show({ color: "teal", message: options.notifyMessage });
    }
  }

  const refreshProjectSnapshot = useEffectEvent(async () => {
    if (!snapshot || syncInFlightRef.current) {
      return null;
    }

    const requestId = syncRequestIdRef.current + 1;
    syncRequestIdRef.current = requestId;
    syncInFlightRef.current = true;

    try {
      const result = await requestJson<ProjectSnapshot>("/api/project", {
        cache: "no-store",
      });

      if (!shouldApplySyncedSnapshot(requestId, syncRequestIdRef.current)) {
        return null;
      }

      applySnapshotUpdate(result);
      return result;
    } catch {
      return null;
    } finally {
      if (shouldApplySyncedSnapshot(requestId, syncRequestIdRef.current)) {
        syncInFlightRef.current = false;
      }
    }
  });

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
      if (shouldNotify) {
        applyProjectSnapshot(result, { notifyMessage: `Opened ${result.projectPath}` });
      } else {
        applyProjectSnapshot(result);
      }
      setSyncTick((value) => value + 1);
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

  const syncSelectedSlot = useEffectEvent((nextSelection: TrackSlotSelection | null) => {
    setSelectedSlot(nextSelection);
  });

  useEffect(() => {
    const nextSelection = getSelectionFromSnapshot(snapshot);
    if (
      nextSelection?.trackId !== selectedSlot?.trackId ||
      nextSelection?.slotKind !== selectedSlot?.slotKind
    ) {
      syncSelectedSlot(nextSelection);
    }
  }, [selectedSlot?.slotKind, selectedSlot?.trackId, snapshot]);

  const syncSelectedEditorDrafts = useEffectEvent(
    (nextState:
      | {
          kind: "frame";
          entryId: string;
          prompt: string;
          usePreviousFrameAsReference: boolean;
          modelId: string;
          systemPromptTemplate: string;
          settings: GenerationSettings;
        }
      | {
          kind: "transition";
          entryId: string;
          prompt: string;
          modelId: string;
          systemPromptTemplate: string;
          settings: GenerationSettings;
        }
      | null) => {
      if (!nextState) {
        syncedEditorEntryKeyRef.current = null;
        setFramePromptDraft("");
        setFrameUsePreviousDraft(false);
        setFrameModelIdDraft("");
        setFrameSystemPromptTemplateDraft(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
        setFrameGenerationSettingsDraft({});
        setFrameConfigDirty(false);
        setTransitionPromptDraft("");
        setTransitionModelIdDraft("");
        setTransitionSystemPromptTemplateDraft(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
        setTransitionGenerationSettingsDraft({});
        setTransitionConfigDirty(false);
        return;
      }

      const nextEntryKey = `${nextState.kind}:${nextState.entryId}`;
      const shouldSync =
        nextState.kind === "frame"
          ? shouldSyncEditorDraft({
              isDirty: frameConfigDirty,
              currentEntryKey: syncedEditorEntryKeyRef.current,
              nextEntryKey,
            })
          : shouldSyncEditorDraft({
              isDirty: transitionConfigDirty,
              currentEntryKey: syncedEditorEntryKeyRef.current,
              nextEntryKey,
            });

      if (!shouldSync) {
        return;
      }

      syncedEditorEntryKeyRef.current = nextEntryKey;

      if (nextState.kind === "frame") {
        setFramePromptDraft(nextState.prompt);
        setFrameUsePreviousDraft(nextState.usePreviousFrameAsReference);
        setFrameModelIdDraft(nextState.modelId);
        setFrameSystemPromptTemplateDraft(nextState.systemPromptTemplate);
        setFrameGenerationSettingsDraft(getDraftSettingsForModel(nextState.modelId, nextState.settings));
        setFrameConfigDirty(false);
        setTransitionConfigDirty(false);
        return;
      }

      setTransitionPromptDraft(nextState.prompt);
      setTransitionModelIdDraft(nextState.modelId);
      setTransitionSystemPromptTemplateDraft(nextState.systemPromptTemplate);
      setTransitionGenerationSettingsDraft(getDraftSettingsForModel(nextState.modelId, nextState.settings));
      setFrameConfigDirty(false);
      setTransitionConfigDirty(false);
    },
  );

  const syncCurrentSelectionDraft = useEffectEvent(() => {
    if (selectedFrame) {
      const draft = getFrameGenerationDraft(selectedFrame, selectedFrameTileId, projectGenerationDefaults);
      syncSelectedEditorDrafts({
        kind: "frame",
        entryId: selectedFrame.id,
        prompt: draft.prompt,
        usePreviousFrameAsReference: draft.usePreviousFrameAsReference,
        modelId: draft.modelId,
        systemPromptTemplate: draft.systemPromptTemplate,
        settings: draft.settings,
      });
      return;
    }

    if (selectedTransition) {
      const draft = getTransitionGenerationDraft(selectedTransition, selectedTransitionTileId, projectGenerationDefaults);
      syncSelectedEditorDrafts({
        kind: "transition",
        entryId: selectedTransition.id,
        prompt: draft.prompt,
        modelId: draft.modelId,
        systemPromptTemplate: draft.systemPromptTemplate,
        settings: draft.settings,
      });
      return;
    }

    syncSelectedEditorDrafts(null);
  });

  useEffect(() => {
    syncCurrentSelectionDraft();
  }, [
    frameConfigDirty,
    transitionConfigDirty,
    selectedFrame?.id,
    selectedTransition?.id,
    selectedFrameTileId,
    selectedTransitionTileId,
    projectGenerationDefaults,
  ]);

  useEffect(() => {
    if (!projectSettingsModalOpen) {
      return;
    }

    setProjectGenerationDefaultsDraft(cloneGenerationDefaults(projectGenerationDefaults));
  }, [projectGenerationDefaults, projectSettingsModalOpen]);

  useEffect(() => {
    if (!snapshot) {
      previousPendingByEntryRef.current = {};
      previousDefaultTileByEntryRef.current = {};
      return;
    }

    setGallerySelection((current) => {
      const nextState = reconcileGallerySelectionAfterSnapshot({
        currentSelection: current,
        snapshot,
        addTileId: GALLERY_ADD_TILE_ID,
        previousPendingByEntry: previousPendingByEntryRef.current,
        previousDefaultTileByEntry: previousDefaultTileByEntryRef.current,
      });
      previousPendingByEntryRef.current = nextState.pendingByEntry;
      previousDefaultTileByEntryRef.current = nextState.defaultTileByEntry;
      return nextState.selection;
    });
  }, [snapshot]);

  useEffect(() => {
    if (!snapshotProjectPath) {
      return;
    }

    void refreshProjectSnapshot();
  }, [snapshotProjectPath, syncTick]);

  useEffect(() => {
    if (syncIntervalRef.current != null) {
      window.clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    if (!hasActiveGenerationJobs(snapshot)) {
      return;
    }

    syncIntervalRef.current = window.setInterval(() => {
      void refreshProjectSnapshot();
    }, 1000);

    return () => {
      if (syncIntervalRef.current != null) {
        window.clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshProjectSnapshot();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [snapshot]);

  const moviePlaylist: MoviePlaylistEntry[] = transitions.flatMap((transition) => {
    if (!transition.currentVideo) {
      return [];
    }

    return [
      {
        clipId: transition.currentVideo.id,
        transitionId: transition.id,
        label: `Transition ${transition.fromFrame.position + 1} -> ${transition.toFrame.position + 1}`,
        src: assetUrl(transition.currentVideo.outputPath),
        posterSrc: assetUrl(transition.currentVideo.posterPath) || undefined,
        model: transition.currentVideo.model,
      },
    ];
  });
  const movieIndex = moviePlaylist.length ? Math.min(movieCursor, moviePlaylist.length - 1) : 0;
  const activeMovieClip = moviePlaylist[movieIndex] ?? null;
  const movieIsPlaying = moviePlaying && activeMovieClip != null;
  const overviewStats = getSequenceOverviewStats(frames, transitions, moviePlaylist.length);
  const nextStep = getSequenceNextStep(frames, transitions, moviePlaylist.length);
  const isNextStepSelected =
    nextStep.kind === "frame"
      ? selectedFrame?.id === nextStep.entryId
      : nextStep.kind === "transition"
        ? selectedTransition?.id === nextStep.entryId
        : false;
  const showNextStepCard = nextStep.kind === "current_cut_ready" || !isNextStepSelected;

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
      applySnapshotUpdate(result);
      if (successMessage) {
        notifications.show({ color: "teal", message: successMessage });
      }
      return result;
    } catch (error) {
      notifications.show({ color: "red", message: error instanceof Error ? error.message : "Request failed" });
      return null;
    }
  }

  function persistUiState(update: { selectedSlot?: TrackSlotSelection | null; viewMode?: "sequence" | "play"; filter?: "all" | "needsRepair" }) {
    void requestJson<ProjectSnapshot>("/api/project/ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    })
      .then(applySnapshotUpdate)
      .catch(() => {});
  }

  function selectSlot(selection: TrackSlotSelection) {
    setSelectedSlot(selection);
    persistUiState({ selectedSlot: selection });
  }

  function scrollTrackIntoView(trackId: string) {
    requestAnimationFrame(() => {
      trackCardRefs.current[trackId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  async function clearProjectState() {
    if (
      !window.confirm(
        "Clear this project and delete all Moviegen entries and generated assets in this folder? This removes moviegen.project.json, frames/, transitions/, and deleted/, then recreates an empty project.",
      )
    ) {
      return;
    }

    try {
      const result = await requestJson<ProjectSnapshot>("/api/project/clear", {
        method: "POST",
      });
      applyProjectSnapshot(result, { notifyMessage: "Project cleared" });
    } catch (error) {
      notifications.show({ color: "red", message: error instanceof Error ? error.message : "Clear failed" });
    }
  }

  async function addTrack(insertAtTrackIndex: number) {
    const result = await mutate(
      "/api/tracks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insertAtTrackIndex }),
      },
      "Track added",
    );

    if (result?.tracks[insertAtTrackIndex]) {
      const selection = {
        trackId: result.tracks[insertAtTrackIndex]!.id,
        slotKind: "transition" as const,
      };
      setSelectedSlot(selection);
      persistUiState({ selectedSlot: selection });
    }
  }

  function updateProjectGenerationDefaultsDraft(
    modelId: string,
    update: (current: { systemPromptTemplate: string; settings: GenerationSettings }) => {
      systemPromptTemplate: string;
      settings: GenerationSettings;
    },
  ) {
    setProjectGenerationDefaultsDraft((current) => {
      const nextCurrent = current[modelId] ?? {
        systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
        settings: getDraftSettingsForModel(modelId, {}),
      };

      return {
        ...current,
        [modelId]: update({
          systemPromptTemplate: nextCurrent.systemPromptTemplate,
          settings: getDraftSettingsForModel(modelId, nextCurrent.settings),
        }),
      };
    });
  }

  async function saveProjectSettings() {
    const generationDefaults = Object.fromEntries(
      Object.entries(projectGenerationDefaultsDraft).map(([modelId, config]) => [
        modelId,
        {
          systemPromptTemplate: config.systemPromptTemplate,
          settings: getDraftSettingsForModel(modelId, config.settings),
        },
      ]),
    );

    const result = await mutate(
      "/api/project/settings",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationDefaults: {
            byModel: generationDefaults,
          },
        }),
      },
      "Project settings updated",
    );

    if (result) {
      setProjectSettingsModalOpen(false);
    }
  }

  function handleFrameModelDraftChange(modelId: string) {
    setFrameModelIdDraft(modelId);
    setFrameGenerationSettingsDraft((current) => getDraftSettingsForModel(modelId, current));
    setFrameConfigDirty(true);
  }

  function handleTransitionModelDraftChange(modelId: string) {
    setTransitionModelIdDraft(modelId);
    setTransitionGenerationSettingsDraft((current) => getDraftSettingsForModel(modelId, current));
    setTransitionConfigDirty(true);
  }

  function buildGenerationOverridesPayload(
    modelId: string,
    systemPromptTemplate: string,
    settings: GenerationSettings,
  ) {
    return {
      modelId,
      systemPromptTemplate,
      settings: getDraftSettingsForModel(modelId, settings),
    };
  }

  async function saveFrameConfig(
    frameId: string,
    prompt: string,
    usePreviousFrameAsReference: boolean,
    generationOverrides: ReturnType<typeof buildGenerationOverridesPayload>,
    successMessage?: string,
  ) {
    return mutate(
      `/api/frames/${frameId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagePrompt: prompt,
          usePreviousFrameAsReference,
          generationOverrides,
        }),
      },
      successMessage,
    );
  }

  async function queueFrameGeneration(
    frame: FrameView,
    prompt: string,
    usePreviousFrameAsReference: boolean,
    generationOverrides: ReturnType<typeof buildGenerationOverridesPayload>,
    successMessage = "Queued frame generation",
    directAssetPaths?: string[],
  ) {
    if (!directAssetPaths?.length) {
      setSelectedGalleryTile("frame", frame.id, GALLERY_ADD_TILE_ID);
    }
    return mutate(
      `/api/frames/${frame.id}/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directAssetPaths,
          prompt,
          usePreviousFrameAsReference,
          generationOverrides,
        }),
      },
      successMessage,
    );
  }

  async function saveTransitionConfig(
    transitionId: string,
    prompt: string,
    generationOverrides: ReturnType<typeof buildGenerationOverridesPayload>,
    successMessage?: string,
  ) {
    return mutate(
      `/api/transitions/${transitionId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transitionPrompt: prompt,
          generationOverrides,
        }),
      },
      successMessage,
    );
  }

  async function generateSelectedFrame(frame: FrameView) {
    const prompt = framePromptDraft.trim();
    if (!prompt) {
      notifications.show({ color: "yellow", message: "Add a frame prompt first." });
      return;
    }

    const saved = await saveFrameConfig(
      frame.id,
      framePromptDraft,
      frame.position === 0 ? false : frameUsePreviousDraft,
      buildGenerationOverridesPayload(
        frameModelIdDraft,
        frameSystemPromptTemplateDraft,
        frameGenerationSettingsDraft,
      ),
    );
    if (!saved) {
      return;
    }

    await queueFrameGeneration(
      frame,
      prompt,
      frame.position === 0 ? false : frameUsePreviousDraft,
      buildGenerationOverridesPayload(
        frameModelIdDraft,
        frameSystemPromptTemplateDraft,
        frameGenerationSettingsDraft,
      ),
    );
  }

  async function stopSelectedFrameGeneration(frame: FrameView) {
    const fallbackTileId = frame.currentVersion?.id ?? frame.latestVersion?.id ?? GALLERY_ADD_TILE_ID;
    const result = await mutate(
      `/api/frames/${frame.id}/stop`,
      { method: "POST" },
      "Stopped frame generation",
    );

    if (result) {
      setSelectedGalleryTile("frame", frame.id, fallbackTileId);
    }
  }

  useEffect(() => {
    if (!selectedFrame || !frameConfigDirty) {
      return;
    }

    const frameId = selectedFrame.id;
    const prompt = framePromptDraft;
    const usePreviousFrameAsReference = selectedFrame.position === 0 ? false : frameUsePreviousDraft;
    const generationOverrides = buildGenerationOverridesPayload(
      frameModelIdDraft,
      frameSystemPromptTemplateDraft,
      frameGenerationSettingsDraft,
    );
    const requestId = frameAutosaveRequestIdRef.current + 1;
    frameAutosaveRequestIdRef.current = requestId;

    const timeout = window.setTimeout(() => {
      void requestJson<ProjectSnapshot>(`/api/frames/${frameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagePrompt: prompt,
          usePreviousFrameAsReference,
          generationOverrides,
        }),
      })
        .then((result) => {
          if (frameAutosaveRequestIdRef.current !== requestId) {
            return;
          }

          applySnapshotUpdate(result);
          setFrameConfigDirty(false);
        })
        .catch((error) => {
          if (frameAutosaveRequestIdRef.current !== requestId) {
            return;
          }

          notifications.show({ color: "red", message: error instanceof Error ? error.message : "Failed to update frame" });
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    frameConfigDirty,
    framePromptDraft,
    frameUsePreviousDraft,
    frameModelIdDraft,
    frameSystemPromptTemplateDraft,
    frameGenerationSettingsDraft,
    selectedFrame,
  ]);

  async function handleFrameReferenceDrop(frame: FrameView, files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) {
      notifications.show({ color: "yellow", message: "Drop PNG, JPG, WEBP, or GIF images to use as frame references." });
      return;
    }

    try {
      const formData = new FormData();
      for (const file of imageFiles) {
        formData.append("files", file);
      }

      const upload = await requestJson<{ paths: string[] }>("/api/uploads/frame-references", {
        method: "POST",
        body: formData,
      });

      const prompt = framePromptDraft.trim() || frame.imagePrompt.trim();
      if (!prompt) {
        const saved = await mutate(
          `/api/frames/${frame.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              usePreviousFrameAsReference: false,
            }),
          },
        );
        if (!saved) {
          return;
        }

        setFrameUsePreviousDraft(false);

        await queueFrameGeneration(
          frame,
          "",
          false,
          buildGenerationOverridesPayload(
            frameModelIdDraft,
            frameSystemPromptTemplateDraft,
            frameGenerationSettingsDraft,
          ),
          `Imported ${upload.paths.length} frame asset${upload.paths.length === 1 ? "" : "s"}`,
          upload.paths,
        );
        return;
      }

      const saved = await mutate(
        `/api/frames/${frame.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            referenceImages: [...frame.referenceImages, ...upload.paths],
            usePreviousFrameAsReference: false,
          }),
        },
      );
      if (!saved) {
        return;
      }

      setFrameUsePreviousDraft(false);

      await queueFrameGeneration(
        frame,
        prompt,
        false,
        buildGenerationOverridesPayload(
          frameModelIdDraft,
          frameSystemPromptTemplateDraft,
          frameGenerationSettingsDraft,
        ),
        `Queued frame generation from ${upload.paths.length} reference image${upload.paths.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      notifications.show({ color: "red", message: error instanceof Error ? error.message : "Upload failed" });
    }
  }

  function openFrameReferencePicker() {
    frameReferenceInputRef.current?.click();
  }

  async function handleFrameReferenceInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";

    if (!selectedFrame || files.length === 0) {
      return;
    }

    await handleFrameReferenceDrop(selectedFrame, files);
  }

  async function generateSelectedTransition(transition: TransitionView) {
    const saved = await saveTransitionConfig(
      transition.id,
      transitionPromptDraft,
      buildGenerationOverridesPayload(
        transitionModelIdDraft,
        transitionSystemPromptTemplateDraft,
        transitionGenerationSettingsDraft,
      ),
    );
    if (!saved) {
      return;
    }

    setSelectedGalleryTile("transition", transition.id, GALLERY_ADD_TILE_ID);
    await mutate(
      "/api/transitions/bulk-generate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transitionIds: [transition.id],
          promptsByTransitionId: {
            [transition.id]: transitionPromptDraft.trim() || transition.transitionPrompt,
          },
          generationOverridesByTransitionId: {
            [transition.id]: buildGenerationOverridesPayload(
              transitionModelIdDraft,
              transitionSystemPromptTemplateDraft,
              transitionGenerationSettingsDraft,
            ),
          },
        }),
      },
      "Queued transition generation",
    );
  }

  async function stopSelectedTransitionGeneration(transition: TransitionView) {
    const fallbackTileId = transition.currentVideo?.id ?? transition.latestVideoVersion?.id ?? GALLERY_ADD_TILE_ID;
    const result = await mutate(
      `/api/transitions/${transition.id}/stop`,
      { method: "POST" },
      "Stopped transition generation",
    );

    if (result) {
      setSelectedGalleryTile("transition", transition.id, fallbackTileId);
    }
  }

  useEffect(() => {
    if (!selectedTransition || !transitionConfigDirty) {
      return;
    }

    const transitionId = selectedTransition.id;
    const prompt = transitionPromptDraft;
    const generationOverrides = buildGenerationOverridesPayload(
      transitionModelIdDraft,
      transitionSystemPromptTemplateDraft,
      transitionGenerationSettingsDraft,
    );
    const requestId = transitionAutosaveRequestIdRef.current + 1;
    transitionAutosaveRequestIdRef.current = requestId;

    const timeout = window.setTimeout(() => {
      void requestJson<ProjectSnapshot>(`/api/transitions/${transitionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transitionPrompt: prompt,
          generationOverrides,
        }),
      })
        .then((result) => {
          if (transitionAutosaveRequestIdRef.current !== requestId) {
            return;
          }

          applySnapshotUpdate(result);
          setTransitionConfigDirty(false);
        })
        .catch((error) => {
          if (transitionAutosaveRequestIdRef.current !== requestId) {
            return;
          }

          notifications.show({ color: "red", message: error instanceof Error ? error.message : "Failed to update transition" });
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    selectedTransition,
    transitionConfigDirty,
    transitionPromptDraft,
    transitionModelIdDraft,
    transitionSystemPromptTemplateDraft,
    transitionGenerationSettingsDraft,
  ]);

  async function selectFrameVersion(frame: FrameView, versionId: string) {
    const previousTileId = getSelectedGalleryTileId(frame);
    setSelectedGalleryTile("frame", frame.id, versionId);

    if (versionId === frame.currentVersion?.id) {
      return;
    }

    const approved = await mutate(
      `/api/frame-versions/${versionId}/approve`,
      { method: "POST" },
      "Current frame updated",
    );

    if (!approved) {
      setSelectedGalleryTile("frame", frame.id, previousTileId);
    }
  }

  async function selectTransitionVersion(transition: TransitionView, versionId: string) {
    const previousTileId = getSelectedGalleryTileId(transition);
    setSelectedGalleryTile("transition", transition.id, versionId);

    if (versionId === transition.currentVideo?.id) {
      return;
    }

    const approved = await mutate(
      `/api/transition-versions/${versionId}/approve`,
      { method: "POST" },
      "Current clip updated",
    );

    if (!approved) {
      setSelectedGalleryTile("transition", transition.id, previousTileId);
    }
  }

  async function deleteTrack(track: TrackView) {
    if (
      !window.confirm(
        `Delete Track ${track.index + 1}? This removes Frame ${track.endFrame.position + 1} and reconnects the remaining sequence.`,
      )
    ) {
      return;
    }

    const result = await mutate(
      `/api/frames/${track.endFrame.id}/delete`,
      { method: "POST" },
      "Track deleted",
    );
    if (result) {
      setSelectedSlot(getSelectionFromSnapshot(result));
    }
  }

  function selectMovieClip(nextIndex: number) {
    if (!moviePlaylist.length) {
      return;
    }

    const boundedIndex = Math.max(0, Math.min(nextIndex, moviePlaylist.length - 1));
    setMovieCursor(boundedIndex);
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

  function runNextStep() {
    if (nextStep.kind === "current_cut_ready") {
      return;
    }

    const selection = findSelectionForEntry(tracks, nextStep.kind, nextStep.entryId);
    if (!selection) {
      return;
    }

    selectSlot(selection);
    scrollTrackIntoView(selection.trackId);
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
                    <Menu withinPortal position="bottom-end">
                      <Menu.Target>
                        <Button variant="light">Project</Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconFolderOpen size={14} aria-hidden="true" />}
                          onClick={() => setProjectModalOpen(true)}
                        >
                          Open Project…
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconSettings size={14} aria-hidden="true" />}
                          onClick={() => setProjectSettingsModalOpen(true)}
                        >
                          Project Settings…
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} aria-hidden="true" />}
                          onClick={() => void clearProjectState()}
                        >
                          Clear Project
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Group>
              </Card>

              <Flex gap="md" align="flex-start" wrap="wrap">
                <Box style={{ flex: "1 1 calc(68% - 8px)", minWidth: "min(720px, 100%)" }}>
                  <Stack gap="sm">
                    {tracks.length === 0 ? (
                      <Card withBorder radius="xl" p="lg">
                        <Stack gap="md">
                          <Title order={4}>No tracks yet</Title>
                          <Text c="dimmed" size="sm">
                            Tracks compress the sequence into start frame, transition, and end frame slots. Add the first track to begin.
                          </Text>
                          <Button onClick={() => void addTrack(0)}>Add First Track</Button>
                        </Stack>
                      </Card>
                    ) : null}

                    {tracks.length > 0 ? (
                      <>
                        <AddTrackSeparator label="Add track at the beginning" onClick={() => void addTrack(0)} />
                        {tracks.map((track, index) => (
                          <Stack key={track.id} gap="sm">
                            {index > 0 ? (
                              <AddTrackSeparator
                                label={`Add track before Track ${index + 1}`}
                                onClick={() => void addTrack(index)}
                              />
                            ) : null}
                            <TrackCard
                              track={track}
                              selectedSlot={selectedSlot}
                              onSelectSlot={(selection) => {
                                selectSlot(selection);
                                scrollTrackIntoView(track.id);
                              }}
                              onDeleteTrack={() => void deleteTrack(track)}
                              cardRef={(node) => {
                                trackCardRefs.current[track.id] = node;
                              }}
                            />
                          </Stack>
                        ))}
                        <AddTrackSeparator
                          label="Add track at the end"
                          onClick={() => void addTrack(tracks.length)}
                        />
                      </>
                    ) : null}
                  </Stack>
                </Box>

                <Box style={{ flex: "1 1 calc(32% - 8px)", minWidth: 340, maxWidth: 460, alignSelf: "stretch" }}>
                  <Box
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 20,
                    }}
                  >
                    <Stack gap="sm">
                      {showNextStepCard ? (
                        <NextStepCard
                          title={nextStep.title}
                          description={nextStep.description}
                          ctaLabel={nextStep.ctaLabel}
                          onNextStep={runNextStep}
                        />
                      ) : null}

                      <Card withBorder radius="xl" p={PANEL_PADDING}>
                        {!selectedTrack || !selectedSlotView ? (
                          <Stack gap="xs">
                            <Text fw={700}>Select a slot</Text>
                            <Text c="dimmed" size="sm">
                              Click a start frame, transition, or end frame slot to configure it.
                            </Text>
                          </Stack>
                        ) : selectedFrame ? (
                          <Stack gap={8}>
                            <Group justify="space-between" align="flex-start">
                              <Stack gap={2}>
                                <Text fw={700} size="sm">{getSlotSelectionLabel(selectedSlotView)}</Text>
                                <Text c="dimmed" size="xs">
                                  Track {selectedTrack.index + 1} · {selectedSlotView.label}
                                </Text>
                              </Stack>
                              <Group gap="xs">
                                <Badge color={selectedSlotView.statusColor}>{selectedSlotView.statusLabel}</Badge>
                                {selectedSlotView.isStale ? (
                                  <Badge color="orange" variant="light">
                                    Stale
                                  </Badge>
                                ) : null}
                              </Group>
                            </Group>

                            <Text c="dimmed" size="xs">
                              {selectedSlotView.summary}
                            </Text>
                            {selectedSlotView.disabledReason ? (
                              <Text c="orange" size="xs">
                                {selectedSlotView.disabledReason}
                              </Text>
                            ) : null}

                            <Textarea
                              label="Frame Prompt"
                              value={framePromptDraft}
                              onChange={(event) => {
                                setFramePromptDraft(event.currentTarget.value);
                                setFrameConfigDirty(true);
                              }}
                              minRows={2}
                              autosize
                              maxRows={4}
                              autoComplete="off"
                            />
                            <GenerationConfigFields
                              assetKind="frame"
                              modelId={frameModelIdDraft}
                              systemPromptTemplate={frameSystemPromptTemplateDraft}
                              settings={frameGenerationSettingsDraft}
                              onModelIdChange={handleFrameModelDraftChange}
                              onSystemPromptTemplateChange={(value) => {
                                setFrameSystemPromptTemplateDraft(value);
                                setFrameConfigDirty(true);
                              }}
                              onSettingChange={(key, value) => {
                                setFrameGenerationSettingsDraft((current) => ({
                                  ...current,
                                  [key]: value,
                                }));
                                setFrameConfigDirty(true);
                              }}
                            />
                            <Switch
                              label="Use previous frame as reference"
                              checked={selectedFrame.position === 0 ? false : frameUsePreviousDraft}
                              disabled={selectedFrame.position === 0}
                              onChange={(event) => {
                                setFrameUsePreviousDraft(event.currentTarget.checked);
                                setFrameConfigDirty(true);
                              }}
                            />

                            <Group gap="xs" grow>
                              <input
                                ref={frameReferenceInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                hidden
                                onChange={(event) => {
                                  void handleFrameReferenceInputChange(event);
                                }}
                              />
                              <Button
                                size="sm"
                                variant="default"
                                leftSection={<IconFolderOpen size={14} aria-hidden="true" />}
                                onClick={openFrameReferencePicker}
                              >
                                Add File
                              </Button>
                              <Button
                                size="sm"
                                color="cyan"
                                disabled={!selectedSlotView.canGenerate && framePromptDraft.trim().length === 0}
                                onClick={() => void generateSelectedFrame(selectedFrame)}
                              >
                                Generate Asset
                              </Button>
                            </Group>

                            <Divider color="rgba(255,255,255,0.08)" />

                            <AssetGallery
                              title="Compatible Frames"
                              versions={selectedFrame.galleryVersions}
                              selectedTileId={selectedFrameTileId}
                              pendingLabel={
                                selectedFrame.status === "queued"
                                  ? "Queued"
                                  : selectedFrame.status === "generating"
                                    ? "Generating"
                                    : null
                              }
                              kind="frame"
                              getVersionLabel={(version) => version.sourcePrompt?.trim() || "No frame prompt yet"}
                              onDropFiles={(files) => void handleFrameReferenceDrop(selectedFrame, files)}
                              onSelectVersion={(versionId) => void selectFrameVersion(selectedFrame, versionId)}
                              onOpenInfo={(version) => openAssetInfo("frame", version)}
                              onStopPending={() => void stopSelectedFrameGeneration(selectedFrame)}
                            />
                          </Stack>
                        ) : selectedTransition ? (
                          <Stack gap={8}>
                            <Group justify="space-between" align="flex-start">
                              <Stack gap={2}>
                                <Text fw={700} size="sm">{getSlotSelectionLabel(selectedSlotView)}</Text>
                                <Text c="dimmed" size="xs">
                                  Track {selectedTrack.index + 1} · {selectedSlotView.label}
                                </Text>
                              </Stack>
                              <Group gap="xs">
                                <Badge color={selectedSlotView.statusColor}>{selectedSlotView.statusLabel}</Badge>
                                {selectedSlotView.isStale ? (
                                  <Badge color="orange" variant="light">
                                    Stale
                                  </Badge>
                                ) : null}
                              </Group>
                            </Group>

                            <Text c="dimmed" size="xs">
                              {selectedSlotView.summary}
                            </Text>
                            {selectedSlotView.disabledReason ? (
                              <Text c="orange" size="xs">
                                {selectedSlotView.disabledReason}
                              </Text>
                            ) : null}

                            <Textarea
                              label="Transition Prompt"
                              value={transitionPromptDraft}
                              onChange={(event) => {
                                setTransitionPromptDraft(event.currentTarget.value);
                                setTransitionConfigDirty(true);
                              }}
                              minRows={2}
                              autosize
                              maxRows={4}
                              autoComplete="off"
                            />
                            <GenerationConfigFields
                              assetKind="transition"
                              modelId={transitionModelIdDraft}
                              systemPromptTemplate={transitionSystemPromptTemplateDraft}
                              settings={transitionGenerationSettingsDraft}
                              onModelIdChange={handleTransitionModelDraftChange}
                              onSystemPromptTemplateChange={(value) => {
                                setTransitionSystemPromptTemplateDraft(value);
                                setTransitionConfigDirty(true);
                              }}
                              onSettingChange={(key, value) => {
                                setTransitionGenerationSettingsDraft((current) => ({
                                  ...current,
                                  [key]: value,
                                }));
                                setTransitionConfigDirty(true);
                              }}
                            />

                            <Group gap="xs">
                              <Button
                                size="sm"
                                color="cyan"
                                fullWidth
                                disabled={!selectedSlotView.canGenerate}
                                onClick={() => void generateSelectedTransition(selectedTransition)}
                              >
                                Generate Clip
                              </Button>
                            </Group>

                            <Divider color="rgba(255,255,255,0.08)" />

                            <AssetGallery
                              title="Compatible Clips"
                              versions={selectedTransition.galleryVersions}
                              selectedTileId={selectedTransitionTileId}
                              pendingLabel={
                                selectedTransition.videoStatus === "queued" ||
                                selectedTransition.videoStatus === "generating"
                                  ? selectedTransition.videoStatus === "queued"
                                    ? "Queued"
                                    : "Generating"
                                  : null
                              }
                              kind="transition"
                              getVersionLabel={(version) => version.sourcePrompt?.trim() || "No transition prompt yet"}
                              onSelectVersion={(versionId) => void selectTransitionVersion(selectedTransition, versionId)}
                              onOpenInfo={(version) => openAssetInfo("transition", version)}
                              onStopPending={() => void stopSelectedTransitionGeneration(selectedTransition)}
                            />
                          </Stack>
                        ) : null}
                      </Card>

                      <SequenceOverview
                        currentClipCount={overviewStats.currentClipCount}
                        totalTransitionCount={overviewStats.totalTransitionCount}
                        missingInputCount={overviewStats.missingInputCount}
                        actionableGenerationCount={overviewStats.actionableGenerationCount}
                        inProgressCount={overviewStats.inProgressCount}
                        activeMovieClip={activeMovieClip}
                        movieIndex={movieIndex}
                        moviePlaylist={moviePlaylist}
                        movieIsPlaying={movieIsPlaying}
                        movieVideoRef={movieVideoRef}
                        onTogglePlayback={toggleMoviePlayback}
                        onSelectMovieClip={selectMovieClip}
                        onLoadedData={handleActiveMovieLoadedData}
                        onPlay={() => setMoviePlaying(true)}
                        onPause={handleActiveMoviePause}
                        onEnded={handleActiveMovieEnded}
                      />
                    </Stack>
                  </Box>
                </Box>
              </Flex>
            </Stack>
          )}
        </ScrollArea>
      </Box>

      <AssetInfoModal target={assetInfoTarget} onClose={() => setAssetInfoTarget(null)} />

      <Modal
        opened={projectSettingsModalOpen}
        onClose={() => setProjectSettingsModalOpen(false)}
        title="Project Settings"
        size="lg"
      >
        <Stack gap="md">
          {(["frame", "transition"] as const).map((assetKind) => {
            const model = getModelsForAssetKind(assetKind)[0] ?? null;
            if (!model) {
              return null;
            }

            const config = projectGenerationDefaultsDraft[model.id] ?? {
              systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
              settings: getDraftSettingsForModel(model.id, {}),
            };

            return (
              <Card key={assetKind} withBorder radius="lg" p="md">
                <Stack gap="sm">
                  <Text fw={700}>{assetKind === "frame" ? "Frame Defaults" : "Transition Defaults"}</Text>
                  <GenerationConfigFields
                    assetKind={assetKind}
                    modelId={model.id}
                    systemPromptTemplate={config.systemPromptTemplate}
                    settings={getDraftSettingsForModel(model.id, config.settings)}
                    onModelIdChange={() => {}}
                    onSystemPromptTemplateChange={(value) => {
                      updateProjectGenerationDefaultsDraft(model.id, (current) => ({
                        ...current,
                        systemPromptTemplate: value,
                      }));
                    }}
                    onSettingChange={(key, value) => {
                      updateProjectGenerationDefaultsDraft(model.id, (current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          [key]: value,
                        },
                      }));
                    }}
                  />
                </Stack>
              </Card>
            );
          })}
          <Button onClick={() => void saveProjectSettings()}>Save Project Settings</Button>
        </Stack>
      </Modal>

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
    </>
  );
}
