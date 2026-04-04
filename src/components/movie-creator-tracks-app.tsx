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
  IconInfoCircle,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
  IconZoomIn,
} from "@tabler/icons-react";
import type {
  FrameVersion,
  FrameView,
  ProjectSnapshot,
  TrackSlotSelection,
  TrackSlotView,
  TrackView,
  TransitionVersion,
  TransitionView,
} from "@/lib/types";
import {
  getFrameDisplayPrompt,
  getFrameGenerationDraft,
  getSequenceNextStep,
  getSequenceOverviewStats,
  getTransitionDisplayPrompt,
  getTransitionGenerationDraft,
  shouldAutoSelectGeneratedTile,
} from "@/components/movie-creator-app.helpers";

type ApiResult = ProjectSnapshot & {
  impact?: unknown;
};

type ZoomTarget = {
  src: string;
  alt: string;
  title: string;
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
  pending: boolean;
  kind: "frame" | "transition";
  getVersionLabel?: (version: TVersion) => string;
  addTileDisabled?: boolean;
  addTileDescription?: string;
  onSelectAdd: () => void;
  onSelectVersion: (versionId: string) => void;
  onOpenInfo: (version: TVersion) => void;
};

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
  movieVideoRef: React.RefObject<HTMLVideoElement | null>;
  onTogglePlayback: () => void;
  onSelectMovieClip: (index: number) => void;
  onNextStep: () => void;
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

function findFrameVersionByTileId(frame: FrameView, tileId: string) {
  return frame.galleryVersions.find((version) => version.id === tileId) ?? null;
}

function findTransitionVersionByTileId(transition: TransitionView, tileId: string) {
  return transition.galleryVersions.find((version) => version.id === tileId) ?? null;
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

function getFramePreviewVersion(frame: FrameView, selectedTileId: string) {
  if (selectedTileId === GALLERY_ADD_TILE_ID) {
    return frame.currentVersion ?? frame.approvedVersion ?? frame.latestVersion;
  }

  return (
    findFrameVersionByTileId(frame, selectedTileId) ??
    frame.currentVersion ??
    frame.approvedVersion ??
    frame.latestVersion
  );
}

function getTransitionPreviewVersion(transition: TransitionView, selectedTileId: string) {
  if (selectedTileId === GALLERY_ADD_TILE_ID) {
    return transition.currentVideo ?? transition.approvedVideoVersion ?? transition.latestVideoVersion;
  }

  return (
    findTransitionVersionByTileId(transition, selectedTileId) ??
    transition.currentVideo ??
    transition.approvedVideoVersion ??
    transition.latestVideoVersion
  );
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

function ZoomableThumb({ src, zoomSrc, alt, emptyLabel, width, onZoom }: {
  src: string | null | undefined;
  zoomSrc: string | null | undefined;
  alt: string;
  emptyLabel: string;
  width: number | string;
  onZoom: (target: ZoomTarget) => void;
}) {
  const previewSrc = src ? assetUrl(src) : "";
  const expandedSrc = zoomSrc ? assetUrl(zoomSrc) : previewSrc;

  return (
    <Box style={{ width, flex: typeof width === "number" ? `0 0 ${width}px` : undefined }}>
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
              sizes={typeof width === "number" ? `${width}px` : "100vw"}
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
  onOpenInfo,
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
            background:
              selectedTileId === GALLERY_ADD_TILE_ID ? "rgba(30, 70, 92, 0.36)" : "rgba(255,255,255,0.02)",
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
        flex: "1 1 220px",
        minWidth: 220,
        borderRadius: 18,
        border: `1px solid ${borderColor}`,
        background,
        overflow: "hidden",
      }}
    >
      <Stack gap="sm" p="sm">
        <Box
          style={{
            aspectRatio: "16 / 9",
            overflow: "hidden",
            borderRadius: 12,
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
            <Flex h="100%" align="center" justify="center" p="sm">
              <Text c="dimmed" size="sm" ta="center">
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

        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text fw={700} size="sm">
              {getSlotSelectionLabel(slot)}
            </Text>
            <Text c="dimmed" size="xs">
              {slot.label}
            </Text>
          </Stack>
          <Badge color={slot.statusColor}>{slot.statusLabel}</Badge>
        </Group>

        <Text size="sm" lineClamp={2} c={slot.promptPlaceholder ? "dimmed" : undefined}>
          {slot.prompt}
        </Text>

        <Group justify="space-between" gap="xs">
          <Text c="dimmed" size="xs">
            {slot.candidateCount} compatible {slot.entryKind === "frame" ? "frame" : "clip"}
            {slot.candidateCount === 1 ? "" : "s"}
          </Text>
          {slot.isStale ? (
            <Badge color="orange" variant="light">
              Stale
            </Badge>
          ) : null}
        </Group>
      </Stack>
    </UnstyledButton>
  );
}

function TrackCard({
  track,
  selectedSlot,
  onSelectSlot,
  cardRef,
}: {
  track: TrackView;
  selectedSlot: TrackSlotSelection | null;
  onSelectSlot: (selection: TrackSlotSelection) => void;
  cardRef: (node: HTMLDivElement | null) => void;
}) {
  return (
    <Card
      ref={cardRef}
      withBorder
      radius="xl"
      p="md"
      style={{
        background: "rgba(13, 18, 25, 0.9)",
        borderColor: "rgba(84, 96, 112, 0.28)",
      }}
    >
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={700}>Track {track.index + 1}</Text>
            <Text c="dimmed" size="sm">
              Frame {track.startFrame.position + 1} to Frame {track.endFrame.position + 1}
            </Text>
          </Stack>
          <Text c="dimmed" size="xs">
            Shared end/start boundaries stay in sync across adjacent tracks.
          </Text>
        </Group>

        <Flex gap="sm" wrap="wrap">
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

function ZoomModal({ target, onClose }: { target: ZoomTarget | null; onClose: () => void }) {
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
    <Stack gap="sm">
      <Box
        style={{
          padding: 10,
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

      <Box
        style={{
          padding: 12,
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
              {nextStepTitle}
            </Text>
            <Text c="dimmed" size="xs">
              {nextStepDescription}
            </Text>
          </Stack>
          {nextStepCtaLabel ? (
            <Button color="cyan" size="xs" fullWidth onClick={onNextStep}>
              {nextStepCtaLabel}
            </Button>
          ) : null}
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
              padding: 10,
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
  const [zoomTarget, setZoomTarget] = useState<ZoomTarget | null>(null);
  const [assetInfoTarget, setAssetInfoTarget] = useState<AssetInfoTarget | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TrackSlotSelection | null>(getSelectionFromSnapshot(initialSnapshot));
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [gallerySelection, setGallerySelection] = useState<Record<string, string>>({});
  const [movieCursor, setMovieCursor] = useState(0);
  const [moviePlaying, setMoviePlaying] = useState(false);
  const [framePromptDraft, setFramePromptDraft] = useState("");
  const [frameUsePreviousDraft, setFrameUsePreviousDraft] = useState(false);
  const [transitionPromptDraft, setTransitionPromptDraft] = useState("");
  const previousPendingByEntryRef = useRef<Record<string, boolean>>({});
  const previousDefaultTileByEntryRef = useRef<Record<string, string>>({});
  const movieVideoRef = useRef<HTMLVideoElement | null>(null);
  const trackCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const normalizedProjectPath = projectPath.trim();

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

  function applyProjectSnapshot(result: ProjectSnapshot, options?: { notifyMessage?: string; closeProjectModal?: boolean }) {
    setSnapshot(result);
    setProjectPath(result.projectPath);
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

  useEffect(() => {
    const nextSelection = getSelectionFromSnapshot(snapshot);
    if (
      nextSelection?.trackId !== selectedSlot?.trackId ||
      nextSelection?.slotKind !== selectedSlot?.slotKind
    ) {
      setSelectedSlot(nextSelection);
    }
  }, [selectedSlot?.slotKind, selectedSlot?.trackId, snapshot]);

  useEffect(() => {
    if (selectedFrame) {
      const selectedGalleryTileId = getSelectedGalleryTileId(selectedFrame);
      const draft = getFrameGenerationDraft(selectedFrame, selectedGalleryTileId);
      setFramePromptDraft(draft.prompt);
      setFrameUsePreviousDraft(draft.usePreviousFrameAsReference);
      return;
    }

    if (selectedTransition) {
      const selectedGalleryTileId = getSelectedGalleryTileId(selectedTransition);
      const draft = getTransitionGenerationDraft(selectedTransition, selectedGalleryTileId);
      setTransitionPromptDraft(draft.prompt);
      return;
    }

    setFramePromptDraft("");
    setFrameUsePreviousDraft(false);
    setTransitionPromptDraft("");
  }, [
    selectedFrame?.id,
    selectedTransition?.id,
    selectedFrame ? getSelectedGalleryTileId(selectedFrame) : null,
    selectedTransition ? getSelectedGalleryTileId(selectedTransition) : null,
  ]);

  useEffect(() => {
    if (!snapshot) {
      previousPendingByEntryRef.current = {};
      previousDefaultTileByEntryRef.current = {};
      return;
    }

    const nextPendingByEntry: Record<string, boolean> = {};
    const nextDefaultTileByEntry: Record<string, string> = {};
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
        nextDefaultTileByEntry[key] = defaultTileId;

        if (selectedTileId && !validTileIds.has(selectedTileId)) {
          nextSelection[key] = defaultTileId;
          changed = true;
          continue;
        }

        if (shouldAutoSelectGeneratedTile({
          selectedTileId,
          addTileId: GALLERY_ADD_TILE_ID,
          defaultTileId,
          previousDefaultTileId: previousDefaultTileByEntryRef.current[key],
          wasPending: previousPendingByEntryRef.current[key],
          isPending,
        })) {
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
        nextDefaultTileByEntry[key] = defaultTileId;

        if (selectedTileId && !validTileIds.has(selectedTileId)) {
          nextSelection[key] = defaultTileId;
          changed = true;
          continue;
        }

        if (shouldAutoSelectGeneratedTile({
          selectedTileId,
          addTileId: GALLERY_ADD_TILE_ID,
          defaultTileId,
          previousDefaultTileId: previousDefaultTileByEntryRef.current[key],
          wasPending: previousPendingByEntryRef.current[key],
          isPending,
        })) {
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
    previousDefaultTileByEntryRef.current = nextDefaultTileByEntry;
  }, [snapshot]);

  useEffect(() => {
    const hasActiveJobs = snapshot?.manifest.jobs.some((job) => job.status === "queued" || job.status === "running");
    if (!hasActiveJobs) {
      return;
    }

    const interval = window.setInterval(() => {
      void requestJson<ProjectSnapshot>("/api/project")
        .then(setSnapshot)
        .catch(() => {});
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [snapshot?.manifest.jobs]);

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
      .then(setSnapshot)
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

  async function saveSelectedFrameConfig(frame: FrameView) {
    return mutate(
      `/api/frames/${frame.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagePrompt: framePromptDraft,
          usePreviousFrameAsReference: frame.position === 0 ? false : frameUsePreviousDraft,
        }),
      },
      "Frame config saved",
    );
  }

  async function saveSelectedTransitionConfig(transition: TransitionView, notify = true) {
    return mutate(
      `/api/transitions/${transition.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transitionPrompt: transitionPromptDraft,
        }),
      },
      notify ? "Transition config saved" : undefined,
    );
  }

  async function generateSelectedFrame(frame: FrameView) {
    const prompt = framePromptDraft.trim();
    if (!prompt) {
      notifications.show({ color: "yellow", message: "Add a frame prompt first." });
      return;
    }

    setSelectedGalleryTile("frame", frame.id, GALLERY_ADD_TILE_ID);
    await mutate(
      `/api/frames/${frame.id}/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          usePreviousFrameAsReference: frame.position === 0 ? false : frameUsePreviousDraft,
        }),
      },
      "Queued frame generation",
    );
  }

  async function generateSelectedTransition(transition: TransitionView) {
    if (!transitionPromptDraft.trim() && !transition.transitionPrompt.trim()) {
      notifications.show({ color: "yellow", message: "Add a transition prompt first." });
      return;
    }

    const saved = await saveSelectedTransitionConfig(transition, false);
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
        }),
      },
      "Queued transition generation",
    );
  }

  async function approveSelectedFrameVersion(frame: FrameView) {
    const selectedTileId = getSelectedGalleryTileId(frame);
    if (selectedTileId === GALLERY_ADD_TILE_ID) {
      return;
    }

    const approved = await mutate(
      `/api/frame-versions/${selectedTileId}/approve`,
      { method: "POST" },
      "Current frame updated",
    );

    if (approved) {
      setSelectedGalleryTile("frame", frame.id, selectedTileId);
    }
  }

  async function approveSelectedTransitionVersion(transition: TransitionView) {
    const selectedTileId = getSelectedGalleryTileId(transition);
    if (selectedTileId === GALLERY_ADD_TILE_ID) {
      return;
    }

    const approved = await mutate(
      `/api/transition-versions/${selectedTileId}/approve`,
      { method: "POST" },
      "Current clip updated",
    );

    if (approved) {
      setSelectedGalleryTile("transition", transition.id, selectedTileId);
    }
  }

  async function deleteSelectedFrame(frame: FrameView) {
    if (!window.confirm("Delete this frame? Its asset files and connected transition files will be moved into deleted/.")) {
      return;
    }

    const result = await mutate(`/api/frames/${frame.id}/delete`, { method: "POST" }, "Frame archived to deleted/");
    if (result) {
      setSelectedSlot(getSelectionFromSnapshot(result));
    }
  }

  async function deleteSelectedTransition(transition: TransitionView) {
    if (!window.confirm("Delete this transition? Its asset files will be moved into deleted/ and a fresh blank transition will be recreated if the frames remain adjacent.")) {
      return;
    }

    const result = await mutate(
      `/api/transitions/${transition.id}/delete`,
      { method: "POST" },
      "Transition archived to deleted/",
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

  const selectedFrameTileId = selectedFrame ? getSelectedGalleryTileId(selectedFrame) : GALLERY_ADD_TILE_ID;
  const selectedTransitionTileId = selectedTransition ? getSelectedGalleryTileId(selectedTransition) : GALLERY_ADD_TILE_ID;
  const selectedFramePreview = selectedFrame ? getFramePreviewVersion(selectedFrame, selectedFrameTileId) : null;
  const selectedTransitionPreview = selectedTransition ? getTransitionPreviewVersion(selectedTransition, selectedTransitionTileId) : null;

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
                        movieVideoRef={movieVideoRef}
                        onTogglePlayback={toggleMoviePlayback}
                        onSelectMovieClip={selectMovieClip}
                        onNextStep={runNextStep}
                        onLoadedData={handleActiveMovieLoadedData}
                        onPlay={() => setMoviePlaying(true)}
                        onPause={handleActiveMoviePause}
                        onEnded={handleActiveMovieEnded}
                      />

                      <Card withBorder radius="xl" p="md">
                        {!selectedTrack || !selectedSlotView ? (
                          <Stack gap="xs">
                            <Text fw={700}>Select a slot</Text>
                            <Text c="dimmed" size="sm">
                              Click a start frame, transition, or end frame slot to configure it.
                            </Text>
                          </Stack>
                        ) : selectedFrame ? (
                          <Stack gap="md">
                            <Group justify="space-between" align="flex-start">
                              <Stack gap={2}>
                                <Text fw={700}>{getSlotSelectionLabel(selectedSlotView)}</Text>
                                <Text c="dimmed" size="sm">
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

                            <ZoomableThumb
                              src={selectedFramePreview?.thumbnailPath}
                              zoomSrc={selectedFramePreview?.outputPath}
                              alt={selectedSlotView.label}
                              emptyLabel="No image"
                              width="100%"
                              onZoom={setZoomTarget}
                            />

                            <Text c="dimmed" size="sm">
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
                              onChange={(event) => setFramePromptDraft(event.currentTarget.value)}
                              minRows={4}
                              autoComplete="off"
                            />
                            <Switch
                              label="Use previous frame as reference"
                              checked={selectedFrame.position === 0 ? false : frameUsePreviousDraft}
                              disabled={selectedFrame.position === 0}
                              onChange={(event) => setFrameUsePreviousDraft(event.currentTarget.checked)}
                            />

                            <Group gap="xs" grow>
                              <Button variant="light" onClick={() => void saveSelectedFrameConfig(selectedFrame)}>
                                Save Config
                              </Button>
                              <Button
                                color="cyan"
                                disabled={!selectedSlotView.canGenerate && framePromptDraft.trim().length === 0}
                                onClick={() => void generateSelectedFrame(selectedFrame)}
                              >
                                Generate Asset
                              </Button>
                            </Group>

                            {selectedFrameTileId !== GALLERY_ADD_TILE_ID ? (
                              <Button variant="subtle" onClick={() => void approveSelectedFrameVersion(selectedFrame)}>
                                Use Selected Candidate
                              </Button>
                            ) : null}

                            <Divider color="rgba(255,255,255,0.08)" />

                            <AssetGallery
                              title="Compatible Frames"
                              versions={selectedFrame.galleryVersions}
                              selectedTileId={selectedFrameTileId}
                              pending={selectedFrame.status === "queued" || selectedFrame.status === "generating"}
                              kind="frame"
                              getVersionLabel={(version) => version.sourcePrompt?.trim() || "No frame prompt yet"}
                              addTileDisabled={!selectedSlotView.canGenerate && framePromptDraft.trim().length === 0}
                              addTileDescription={selectedSlotView.disabledReason ?? "Generate a new compatible frame"}
                              onSelectAdd={() => void generateSelectedFrame(selectedFrame)}
                              onSelectVersion={(versionId) => setSelectedGalleryTile("frame", selectedFrame.id, versionId)}
                              onOpenInfo={(version) => openAssetInfo("frame", version)}
                            />

                            <Button color="red" variant="subtle" onClick={() => void deleteSelectedFrame(selectedFrame)}>
                              Delete Frame
                            </Button>
                          </Stack>
                        ) : selectedTransition ? (
                          <Stack gap="md">
                            <Group justify="space-between" align="flex-start">
                              <Stack gap={2}>
                                <Text fw={700}>{getSlotSelectionLabel(selectedSlotView)}</Text>
                                <Text c="dimmed" size="sm">
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

                            <ZoomableThumb
                              src={selectedTransitionPreview?.posterPath}
                              zoomSrc={selectedTransitionPreview?.outputPath}
                              alt={selectedSlotView.label}
                              emptyLabel="No clip"
                              width="100%"
                              onZoom={setZoomTarget}
                            />

                            <Text c="dimmed" size="sm">
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
                              onChange={(event) => setTransitionPromptDraft(event.currentTarget.value)}
                              minRows={4}
                              autoComplete="off"
                            />

                            <Group gap="xs" grow>
                              <Button variant="light" onClick={() => void saveSelectedTransitionConfig(selectedTransition)}>
                                Save Config
                              </Button>
                              <Button
                                color="cyan"
                                disabled={!selectedSlotView.canGenerate && transitionPromptDraft.trim().length === 0}
                                onClick={() => void generateSelectedTransition(selectedTransition)}
                              >
                                Generate Clip
                              </Button>
                            </Group>

                            {selectedTransitionTileId !== GALLERY_ADD_TILE_ID ? (
                              <Button variant="subtle" onClick={() => void approveSelectedTransitionVersion(selectedTransition)}>
                                Use Selected Candidate
                              </Button>
                            ) : null}

                            <Divider color="rgba(255,255,255,0.08)" />

                            <AssetGallery
                              title="Compatible Clips"
                              versions={selectedTransition.galleryVersions}
                              selectedTileId={selectedTransitionTileId}
                              pending={
                                selectedTransition.videoStatus === "queued" ||
                                selectedTransition.videoStatus === "generating"
                              }
                              kind="transition"
                              getVersionLabel={(version) => version.sourcePrompt?.trim() || "No transition prompt yet"}
                              addTileDisabled={!selectedSlotView.canGenerate && transitionPromptDraft.trim().length === 0}
                              addTileDescription={selectedSlotView.disabledReason ?? "Generate a new compatible clip"}
                              onSelectAdd={() => void generateSelectedTransition(selectedTransition)}
                              onSelectVersion={(versionId) => setSelectedGalleryTile("transition", selectedTransition.id, versionId)}
                              onOpenInfo={(version) => openAssetInfo("transition", version)}
                            />

                            <Button color="red" variant="subtle" onClick={() => void deleteSelectedTransition(selectedTransition)}>
                              Delete Transition
                            </Button>
                          </Stack>
                        ) : null}
                      </Card>
                    </Stack>
                  </Box>
                </Box>
              </Flex>
            </Stack>
          )}
        </ScrollArea>
      </Box>

      <ZoomModal target={zoomTarget} onClose={() => setZoomTarget(null)} />
      <AssetInfoModal target={assetInfoTarget} onClose={() => setAssetInfoTarget(null)} />

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
