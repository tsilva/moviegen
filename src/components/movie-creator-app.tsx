"use client";

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
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
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
  IconChevronDown,
  IconDotsVertical,
  IconFolderOpen,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
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

type ApiResult = ProjectSnapshot & {
  impact?: ReorderImpactSummary;
};

type ZoomTarget = {
  src: string;
  alt: string;
  title: string;
};

type MovieCreatorAppProps = {
  initialSnapshot?: ProjectSnapshot | null;
  initialProjectPath?: string;
};

const DEFAULT_PROJECT_PATH = process.env.NEXT_PUBLIC_DEFAULT_PROJECT_PATH?.trim() ?? "";
const PROJECT_PATH_PLACEHOLDER =
  process.env.NEXT_PUBLIC_DEFAULT_PROJECT_PATH ?? "/Users/tsilva/Desktop/moviegen";
const WORKSPACE_HEIGHT = "calc(100dvh - 32px)";

function assetUrl(relativePath: string | null | undefined) {
  if (!relativePath) {
    return "";
  }

  return `/api/assets?path=${encodeURIComponent(relativePath)}`;
}

function frameLabel(frame: Pick<FrameView, "position">) {
  return `Frame ${frame.position + 1}`;
}

function transitionLabel(transition: Pick<TransitionView, "fromFrame" | "toFrame">) {
  return `${frameLabel(transition.fromFrame)} to ${frameLabel(transition.toFrame)}`;
}

function frameStatusLabel(frame: FrameView) {
  switch (frame.status) {
    case "blocked_upstream":
      return "Blocked";
    case "stale_dependency":
      return "Needs Repair";
    case "queued":
      return "Queued";
    case "generating":
      return "Generating";
    case "generated_unreviewed":
      return "Needs Review";
    case "approved":
      return "Stable";
    case "error":
      return "Error";
    default:
      return "Draft";
  }
}

function frameStatusColor(frame: FrameView) {
  switch (frame.status) {
    case "approved":
      return "teal";
    case "generated_unreviewed":
      return "yellow";
    case "queued":
    case "generating":
      return "blue";
    case "blocked_upstream":
      return "gray";
    case "stale_dependency":
      return "orange";
    case "error":
      return "red";
    default:
      return "gray";
  }
}

function framePrimaryActionLabel(frame: FrameView) {
  if (frame.status === "blocked_upstream") {
    return "Waiting on upstream";
  }

  switch (frame.nextAction) {
    case "generate":
      return "Generate";
    case "review":
      return "Review";
    default:
      return "Up to date";
  }
}

function frameSummary(frame: FrameView) {
  if (frame.status === "blocked_upstream") {
    return "An upstream frame changed or is still regenerating. This frame will unlock once the previous current output exists.";
  }

  if (frame.status === "stale_dependency") {
    return "Its prompt, reference mode, or upstream frame changed. Regenerate this frame before the queue moves downstream.";
  }

  if (frame.status === "generated_unreviewed") {
    return "A current candidate exists for the latest dependency chain. Review it before relying on it downstream.";
  }

  if (frame.status === "approved") {
    return "This frame is aligned with the current dependency chain.";
  }

  if (frame.status === "queued" || frame.status === "generating") {
    return "Repair is already running for this frame.";
  }

  if (frame.status === "error") {
    return "The last generation attempt failed. Regenerate once the prompt or upstream state looks correct.";
  }

  return "No current output exists yet.";
}

function transitionStatusLabel(transition: TransitionView) {
  if (!transition.transitionPrompt.trim()) {
    return "Prompt Missing";
  }

  if (transition.blockedByFrameIds.length > 0) {
    return "Blocked";
  }

  switch (transition.videoStatus) {
    case "queued":
      return "Queued";
    case "generating":
      return "Generating";
    case "generated_unreviewed":
      return "Needs Review";
    case "approved":
      return "Stable";
    case "stale":
      return "Needs Repair";
    case "error":
      return "Error";
    default:
      return "Ready";
  }
}

function transitionStatusColor(transition: TransitionView) {
  if (!transition.transitionPrompt.trim()) {
    return "yellow";
  }

  if (transition.blockedByFrameIds.length > 0) {
    return "gray";
  }

  switch (transition.videoStatus) {
    case "approved":
      return "teal";
    case "generated_unreviewed":
      return "yellow";
    case "queued":
    case "generating":
      return "blue";
    case "stale":
      return "orange";
    case "error":
      return "red";
    default:
      return "cyan";
  }
}

function transitionPrimaryActionLabel(transition: TransitionView) {
  if (transition.blockedByFrameIds.length > 0) {
    return "Waiting on frames";
  }

  switch (transition.nextAction) {
    case "write_prompt":
      return "Write Prompt";
    case "generate":
      return "Generate";
    case "review":
      return "Review";
    default:
      return "Up to date";
  }
}

function transitionSummary(transition: TransitionView) {
  if (!transition.transitionPrompt.trim()) {
    return "Add a prompt after the adjacent frames are current.";
  }

  if (transition.blockedByFrameIds.length > 0) {
    return "One or both adjacent frames are not current yet. This clip stays blocked until the frame chain is repaired.";
  }

  if (transition.videoStatus === "stale" || transition.videoStatus === "not_ready") {
    return "The current frame pair changed or no matching clip exists. Generate a fresh transition for the latest pair.";
  }

  if (transition.videoStatus === "generated_unreviewed") {
    return "A current clip exists for the latest frame pair. Review it before considering the transition stable.";
  }

  if (transition.videoStatus === "approved") {
    return "This transition matches the latest current frame pair.";
  }

  if (transition.videoStatus === "queued" || transition.videoStatus === "generating") {
    return "Repair is already running for this transition.";
  }

  if (transition.videoStatus === "error") {
    return "The last generation attempt failed. Regenerate after the frame chain is stable.";
  }

  return "This transition is ready to generate.";
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

type CandidateStripProps<TVersion extends FrameVersion | TransitionVersion> = {
  title: string;
  versions: TVersion[];
  approvedVersionId: string | null;
  kind: "frame" | "transition";
  onApprove: (versionId: string) => void;
};

function CandidateStrip<TVersion extends FrameVersion | TransitionVersion>({
  title,
  versions,
  approvedVersionId,
  kind,
  onApprove,
}: CandidateStripProps<TVersion>) {
  if (!versions.length) {
    return null;
  }

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        {title}
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        {versions
          .slice()
          .reverse()
          .map((version) => {
            const isApproved = approvedVersionId === version.id;

            return (
              <Card key={version.id} withBorder radius="lg" p="sm">
                <Stack gap="sm">
                  <Box
                    style={{
                      aspectRatio: "16 / 9",
                      overflow: "hidden",
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.04)",
                    }}
                  >
                    {"thumbnailPath" in version ? (
                      <Box style={{ position: "relative", width: "100%", height: "100%" }}>
                        <Image
                          src={assetUrl(version.thumbnailPath)}
                          alt={`Candidate ${version.id}`}
                          fill
                          unoptimized
                          sizes="(max-width: 1024px) 100vw, 420px"
                          style={{ objectFit: "cover", display: "block" }}
                        />
                      </Box>
                    ) : (
                      <video
                        controls
                        playsInline
                        preload="metadata"
                        poster={assetUrl(version.posterPath) || undefined}
                        src={assetUrl(version.outputPath)}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    )}
                  </Box>
                  <Group justify="space-between">
                    <Text c="dimmed" size="xs">
                      {version.model}
                    </Text>
                    <Badge color={isApproved ? "teal" : "gray"}>{isApproved ? "Approved" : "Candidate"}</Badge>
                  </Group>
                  <Button
                    onClick={() => onApprove(version.id)}
                    variant={isApproved ? "light" : "filled"}
                    disabled={isApproved}
                  >
                    {isApproved ? "Current Approval" : `Approve ${kind}`}
                  </Button>
                </Stack>
              </Card>
            );
          })}
      </SimpleGrid>
    </Stack>
  );
}

type FrameQueueCardProps = {
  frame: FrameView;
  selected: boolean;
  reorderMode: boolean;
  promptValue: string;
  detailsExpanded: boolean;
  onSelect: () => void;
  onPrimaryAction: () => void;
  onDelete: () => void;
  onZoom: (target: ZoomTarget) => void;
  onPromptChange: (value: string) => void;
  onPromptFocus: () => void;
  onPromptCommit: (value: string) => void;
  onToggleDetails: () => void;
  onReferenceModeChange: (checked: boolean) => void;
  onApproveVersion: (versionId: string) => void;
};

function FrameQueueCard({
  frame,
  selected,
  reorderMode,
  promptValue,
  detailsExpanded,
  onSelect,
  onPrimaryAction,
  onDelete,
  onZoom,
  onPromptChange,
  onPromptFocus,
  onPromptCommit,
  onToggleDetails,
  onReferenceModeChange,
  onApproveVersion,
}: FrameQueueCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: frame.id,
  });
  const previewVersion = frame.currentVersion ?? frame.approvedVersion ?? frame.latestVersion;
  const primaryActionLabel = framePrimaryActionLabel(frame);
  const showAction = frame.nextAction != null;

  return (
    <Card
      ref={setNodeRef}
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
              alt={frameLabel(frame)}
              emptyLabel={frame.status === "queued" || frame.status === "generating" ? "Preparing…" : "No image"}
              width={180}
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
              <Group gap="xs" wrap="nowrap">
                <Badge color={frameStatusColor(frame)}>{frameStatusLabel(frame)}</Badge>
                {frame.dependsOnPreviousFrame ? (
                  <Badge variant="light" color="gray">
                    Anchored
                  </Badge>
                ) : null}
                {frame.downstreamImpactCount > 0 ? (
                  <Badge variant="light" color="orange">
                    +{frame.downstreamImpactCount} downstream
                  </Badge>
                ) : null}
              </Group>
              <Group gap="xs">
                {reorderMode ? (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`Drag ${frameLabel(frame)}`}
                    {...attributes}
                    {...listeners}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <IconArrowsShuffle size={16} aria-hidden="true" />
                  </ActionIcon>
                ) : null}
                <Menu withinPortal position="bottom-end">
                  <Menu.Target>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label={`${frameLabel(frame)} actions`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <IconDotsVertical size={16} aria-hidden="true" />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
                    <Menu.Item color="red" leftSection={<IconTrash size={14} aria-hidden="true" />} onClick={onDelete}>
                      Delete frame
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>

            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text fw={600}>{frameLabel(frame)}</Text>
                <Text c="dimmed" lineClamp={2} size="sm">
                  {frame.imagePrompt || "No prompt yet."}
                </Text>
              </Stack>
              <Button
                variant={frame.nextAction === "review" ? "filled" : "light"}
                onClick={(event) => {
                  event.stopPropagation();
                  onPrimaryAction();
                }}
                disabled={!showAction}
              >
                {primaryActionLabel}
              </Button>
            </Group>

            <Text c="dimmed" size="sm">
              {frameSummary(frame)}
            </Text>
          </Stack>
        </Group>

        {selected ? (
          <>
            <Divider color="rgba(255,255,255,0.08)" />
            <Stack gap="md" onClick={(event) => event.stopPropagation()}>
              <Textarea
                label="Image Prompt"
                minRows={4}
                value={promptValue}
                onChange={(event) => onPromptChange(event.currentTarget.value)}
                onFocus={onPromptFocus}
                onBlur={(event) => onPromptCommit(event.currentTarget.value)}
                placeholder="Describe the frame…"
                name={`frame-prompt-${frame.id}`}
                autosize
                maxRows={10}
                autoComplete="off"
              />
              <Button
                variant="subtle"
                justify="space-between"
                rightSection={
                  <IconChevronDown
                    size={16}
                    aria-hidden="true"
                    style={{ transform: detailsExpanded ? "rotate(180deg)" : undefined }}
                  />
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleDetails();
                }}
              >
                {detailsExpanded ? "Hide details" : "Show details"}
              </Button>
              {detailsExpanded ? (
                <Stack gap="md">
                  <Switch
                    checked={frame.usePreviousFrameAsReference}
                    onChange={(event) => onReferenceModeChange(event.currentTarget.checked)}
                    label="Use Previous Frame As Reference"
                  />
                  <Text c="dimmed" size="sm">
                    {frame.usePreviousFrameAsReference
                      ? "This frame inherits continuity from the previous current frame output."
                      : "This frame stands on its own and does not repair automatically from upstream changes."}
                  </Text>
                  <CandidateStrip
                    title={frame.nextAction === "review" ? "Review Current Candidates" : "Candidate History"}
                    versions={frame.versions}
                    approvedVersionId={frame.approvedVersionId}
                    kind="frame"
                    onApprove={onApproveVersion}
                  />
                </Stack>
              ) : null}
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
  detailsExpanded: boolean;
  onSelect: () => void;
  onPrimaryAction: () => void;
  onDelete: () => void;
  onMovePair: () => void;
  onZoom: (target: ZoomTarget) => void;
  onPromptChange: (value: string) => void;
  onPromptFocus: () => void;
  onPromptCommit: (value: string) => void;
  onToggleDetails: () => void;
  onApproveVersion: (versionId: string) => void;
};

function TransitionQueueCard({
  transition,
  selected,
  reorderMode,
  promptValue,
  detailsExpanded,
  onSelect,
  onPrimaryAction,
  onDelete,
  onMovePair,
  onZoom,
  onPromptChange,
  onPromptFocus,
  onPromptCommit,
  onToggleDetails,
  onApproveVersion,
}: TransitionQueueCardProps) {
  const previewVideo = transition.approvedVideoVersion ?? transition.latestVideoVersion;
  const primaryActionLabel = transitionPrimaryActionLabel(transition);
  const showAction = transition.nextAction != null;
  const fromPreview = transition.fromFrame.currentVersion ?? transition.fromFrame.latestVersion;
  const toPreview = transition.toFrame.currentVersion ?? transition.toFrame.latestVersion;

  return (
    <Card
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
            <SimpleGrid cols={2} spacing="xs" style={{ width: 220, flex: "0 0 220px" }}>
              <ZoomableThumb
                src={fromPreview?.thumbnailPath}
                zoomSrc={fromPreview?.outputPath}
                alt={frameLabel(transition.fromFrame)}
                emptyLabel="Pending"
                width={104}
                onZoom={onZoom}
              />
              <ZoomableThumb
                src={toPreview?.thumbnailPath}
                zoomSrc={toPreview?.outputPath}
                alt={frameLabel(transition.toFrame)}
                emptyLabel="Pending"
                width={104}
                onZoom={onZoom}
              />
            </SimpleGrid>
          )}

          <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <Badge color={transitionStatusColor(transition)}>{transitionStatusLabel(transition)}</Badge>
                {transition.downstreamImpactCount > 0 ? (
                  <Badge variant="light" color="orange">
                    +{transition.downstreamImpactCount} downstream
                  </Badge>
                ) : null}
              </Group>
              <Menu withinPortal position="bottom-end">
                <Menu.Target>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`${transitionLabel(transition)} actions`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <IconDotsVertical size={16} aria-hidden="true" />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
                  {reorderMode ? (
                    <Menu.Item
                      leftSection={<IconArrowsShuffle size={14} aria-hidden="true" />}
                      onClick={onMovePair}
                    >
                      Move Pair
                    </Menu.Item>
                  ) : null}
                  <Menu.Item
                    color="red"
                    leftSection={<IconTrash size={14} aria-hidden="true" />}
                    onClick={onDelete}
                  >
                    Delete transition
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>

            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text fw={600}>{transitionLabel(transition)}</Text>
                <Text c="dimmed" lineClamp={2} size="sm">
                  {transition.transitionPrompt || "No prompt yet."}
                </Text>
              </Stack>
              <Button
                variant={transition.nextAction === "review" ? "filled" : "light"}
                onClick={(event) => {
                  event.stopPropagation();
                  onPrimaryAction();
                }}
                disabled={!showAction}
              >
                {primaryActionLabel}
              </Button>
            </Group>

            <Text c="dimmed" size="sm">
              {transitionSummary(transition)}
            </Text>
          </Stack>
        </Group>

        {selected ? (
          <>
            <Divider color="rgba(255,255,255,0.08)" />
            <Stack gap="md" onClick={(event) => event.stopPropagation()}>
              <Textarea
                label="Transition Prompt"
                minRows={4}
                value={promptValue}
                onChange={(event) => onPromptChange(event.currentTarget.value)}
                onFocus={onPromptFocus}
                onBlur={(event) => onPromptCommit(event.currentTarget.value)}
                placeholder="Describe the motion between these frames…"
                name={`transition-prompt-${transition.id}`}
                autosize
                maxRows={10}
                autoComplete="off"
              />
              <Button
                variant="subtle"
                justify="space-between"
                rightSection={
                  <IconChevronDown
                    size={16}
                    aria-hidden="true"
                    style={{ transform: detailsExpanded ? "rotate(180deg)" : undefined }}
                  />
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleDetails();
                }}
              >
                {detailsExpanded ? "Hide details" : "Show details"}
              </Button>
              {detailsExpanded ? (
                <Stack gap="md">
                  <Text c="dimmed" size="sm">
                    Transition generation always uses the latest current output from both adjacent frames.
                  </Text>
                  <CandidateStrip
                    title={transition.nextAction === "review" ? "Review Current Clips" : "Clip History"}
                    versions={transition.versions}
                    approvedVersionId={transition.approvedVideoVersionId}
                    kind="transition"
                    onApprove={onApproveVersion}
                  />
                </Stack>
              ) : null}
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
  const [reorderMode, setReorderMode] = useState(false);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [activeEditor, setActiveEditor] = useState<null | "framePrompt" | "transitionPrompt">(null);
  const [framePromptDraft, setFramePromptDraft] = useState("");
  const [transitionPromptDraft, setTransitionPromptDraft] = useState("");
  const [isPending, startTransition] = useTransition();
  const previousSelectedFrameRef = useRef<{
    id: string | null;
    status: FrameView["status"] | null;
  }>({ id: null, status: null });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const normalizedProjectPath = projectPath.trim();

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
      setFramePromptDraft(
        result.frames.find((frame) => frame.id === nextSelection.selectedFrameId)?.imagePrompt ?? "",
      );
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
    if (activeEditor) {
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
  }, [activeEditor, snapshot?.manifest.jobs]);

  const frames = snapshot?.frames ?? [];
  const transitions = snapshot?.transitions ?? [];
  const filter = snapshot?.manifest.ui.filter ?? "needsRepair";
  const transitionMap = new Map(transitions.map((transition) => [transition.fromFrameId, transition]));
  const selectedFrame = selectedFrameId ? frames.find((frame) => frame.id === selectedFrameId) ?? null : null;

  function shouldShowFrame(frame: FrameView) {
    if (reorderMode) {
      return true;
    }

    if (filter === "all") {
      return true;
    }

    return frame.status !== "approved";
  }

  function shouldShowTransition(transition: TransitionView) {
    if (reorderMode) {
      return true;
    }

    if (filter === "all") {
      return true;
    }

    return (
      transition.videoStatus !== "approved" ||
      transition.nextAction != null ||
      transition.blockedByFrameIds.length > 0 ||
      transition.promptStatus !== "confirmed"
    );
  }

  const visibleFrames = frames.filter(shouldShowFrame);
  const actionableQueue = [
    ...frames.filter((frame) => frame.nextAction != null),
    ...transitions.filter((transition) => transition.nextAction != null),
  ].sort((left, right) => left.queueRank - right.queueRank);

  const repairCount = frames.filter((frame) => frame.status === "draft" || frame.status === "stale_dependency" || frame.status === "error").length +
    transitions.filter((transition) => transition.nextAction === "generate" || transition.nextAction === "write_prompt").length;
  const reviewCount = frames.filter((frame) => frame.nextAction === "review").length +
    transitions.filter((transition) => transition.nextAction === "review").length;
  const stableCount = frames.filter((frame) => frame.status === "approved").length +
    transitions.filter((transition) => transition.videoStatus === "approved").length;

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

  function selectFrame(frameId: string) {
    const frame = frames.find((item) => item.id === frameId) ?? null;
    setSelectedFrameId(frameId);
    setSelectedTransitionId(null);
    setFramePromptDraft(frame?.imagePrompt ?? "");
    setActiveEditor(null);
    persistUiState({ selectedFrameId: frameId, selectedTransitionId: null });
  }

  function selectTransition(transitionId: string) {
    const transition = transitions.find((item) => item.id === transitionId) ?? null;
    setSelectedTransitionId(transitionId);
    setSelectedFrameId(null);
    setTransitionPromptDraft(transition?.transitionPrompt ?? "");
    setActiveEditor(null);
    persistUiState({ selectedTransitionId: transitionId, selectedFrameId: null });
  }

  function detailsKey(kind: "frame" | "transition", id: string) {
    return `${kind}:${id}`;
  }

  function toggleDetails(kind: "frame" | "transition", id: string) {
    const key = detailsKey(kind, id);
    setExpandedDetails((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function patchFrameLocally(frameId: string, patch: Partial<FrameView>) {
    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        frames: current.frames.map((frame) => (frame.id === frameId ? { ...frame, ...patch } : frame)),
        manifest: {
          ...current.manifest,
          frames: current.manifest.frames.map((frame) => (frame.id === frameId ? { ...frame, ...patch } : frame)),
        },
      };
    });
  }

  async function commitFramePrompt(frame: FrameView, value: string) {
    setActiveEditor(null);
    const normalizedValue = value;
    if (normalizedValue === frame.imagePrompt) {
      setFramePromptDraft(normalizedValue);
      return;
    }

    const success = await mutate(
      `/api/frames/${frame.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePrompt: normalizedValue }),
      },
      "Frame updated",
    );

    if (!success) {
      setFramePromptDraft(frame.imagePrompt);
    } else {
      setFramePromptDraft(normalizedValue);
    }
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

    await mutate(url, { method: "POST" }, "Approval saved");
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

  async function runFramePrimaryAction(frame: FrameView) {
    selectFrame(frame.id);

    if (frame.nextAction === "generate") {
      await mutate(`/api/frames/${frame.id}/generate`, { method: "POST" }, "Queued frame generation");
      return;
    }

    if (frame.nextAction === "review") {
      notifications.show({ color: "cyan", message: "Review the current candidates inline below the frame." });
    }
  }

  async function runTransitionPrimaryAction(transition: TransitionView) {
    selectTransition(transition.id);

    if (transition.nextAction === "write_prompt") {
      notifications.show({ color: "cyan", message: "Write the transition prompt inline below this row." });
      return;
    }

    if (transition.nextAction === "generate") {
      await mutate(
        "/api/transitions/bulk-generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transitionIds: [transition.id] }),
        },
        "Queued transition generation",
      );
      return;
    }

    if (transition.nextAction === "review") {
      notifications.show({ color: "cyan", message: "Review the current clips inline below the transition." });
    }
  }

  async function runNextRepair() {
    const nextTarget = actionableQueue[0] ?? null;
    if (!nextTarget) {
      notifications.show({ color: "gray", message: "The repair queue is empty." });
      return;
    }

    if ("imagePrompt" in nextTarget) {
      await runFramePrimaryAction(nextTarget);
      return;
    }

    await runTransitionPrimaryAction(nextTarget);
  }

  async function runAllReady() {
    const framesNeedingGeneration = frames.filter((frame) => frame.nextAction === "generate");
    const transitionsReadyToGenerate = transitions.filter((transition) => transition.nextAction === "generate");

    if (framesNeedingGeneration.length) {
      await mutate(
        "/api/frames/bulk-generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frameIds: framesNeedingGeneration.map((frame) => frame.id), candidateCount: 1 }),
        },
        "Queued frame generation",
      );
      return;
    }

    if (transitionsReadyToGenerate.length) {
      await mutate(
        "/api/transitions/bulk-generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transitionIds: transitionsReadyToGenerate.map((transition) => transition.id) }),
        },
        "Queued transition generation",
      );
      return;
    }

    notifications.show({ color: "gray", message: "There are no ready items to batch." });
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
        body: JSON.stringify({ rows }),
      },
      `Created ${rows.length} frames`,
    );

    if (success) {
      setBulkInput("");
      setBulkModalOpen(false);
    }
  }

  useEffect(() => {
    const previous = previousSelectedFrameRef.current;
    let reviewTimeout: number | null = null;

    if (
      selectedFrame &&
      previous.id === selectedFrame.id &&
      (previous.status === "queued" || previous.status === "generating") &&
      selectedFrame.nextAction === "review"
    ) {
      reviewTimeout = window.setTimeout(() => {
        notifications.show({
          color: "cyan",
          message: `${frameLabel(selectedFrame)} is ready to review inline.`,
        });
      }, 0);
    }

    previousSelectedFrameRef.current = {
      id: selectedFrame?.id ?? null,
      status: selectedFrame?.status ?? null,
    };

    return () => {
      if (reviewTimeout !== null) {
        window.clearTimeout(reviewTimeout);
      }
    };
  }, [selectedFrame]);

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
                    <Button leftSection={<IconWand size={16} aria-hidden="true" />} onClick={() => void runNextRepair()}>
                      Run Next Repair
                    </Button>
                    <Button
                      variant="light"
                      leftSection={<IconRefresh size={16} aria-hidden="true" />}
                      onClick={() => void refreshProject()}
                    >
                      Refresh
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
                          leftSection={<IconPlus size={14} aria-hidden="true" />}
                          onClick={() => setBulkModalOpen(true)}
                        >
                          Add Frames…
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconPlayerPlay size={14} aria-hidden="true" />}
                          onClick={() => void runAllReady()}
                        >
                          Run All Ready
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconArrowsShuffle size={14} aria-hidden="true" />}
                          onClick={() => {
                            const nextValue = !reorderMode;
                            setReorderMode(nextValue);
                            if (nextValue && filter !== "all") {
                              persistUiState({ filter: "all" });
                            }
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
                <Badge color={repairCount > 0 ? "orange" : "gray"} size="lg">
                  {repairCount} Needs Repair
                </Badge>
                <Badge color={reviewCount > 0 ? "yellow" : "gray"} size="lg">
                  {reviewCount} Needs Review
                </Badge>
                <Badge color="teal" size="lg">
                  {stableCount} Stable
                </Badge>
                <SegmentedControl
                  value={filter}
                  onChange={(value) => persistUiState({ filter: value })}
                  data={[
                    { label: "Needs Repair", value: "needsRepair" },
                    { label: "All", value: "all" },
                  ]}
                />
              </Group>

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
                    {(reorderMode ? frames : visibleFrames).map((frame) => {
                      const transition = transitionMap.get(frame.id) ?? null;
                      return (
                        <Stack key={frame.id} gap="sm">
                          <FrameQueueCard
                            frame={frame}
                            selected={selectedFrameId === frame.id}
                            reorderMode={reorderMode}
                            promptValue={
                              selectedFrameId === frame.id && activeEditor === "framePrompt"
                                ? framePromptDraft
                                : frame.imagePrompt
                            }
                            detailsExpanded={expandedDetails[detailsKey("frame", frame.id)] ?? false}
                            onSelect={() => selectFrame(frame.id)}
                            onPrimaryAction={() => void runFramePrimaryAction(frame)}
                            onDelete={() => void deleteFrame(frame.id)}
                            onZoom={setZoomTarget}
                            onPromptChange={setFramePromptDraft}
                            onPromptFocus={() => {
                              setFramePromptDraft(frame.imagePrompt);
                              setActiveEditor("framePrompt");
                            }}
                            onPromptCommit={(value) => void commitFramePrompt(frame, value)}
                            onToggleDetails={() => toggleDetails("frame", frame.id)}
                            onReferenceModeChange={(checked) => {
                              patchFrameLocally(frame.id, { usePreviousFrameAsReference: checked });
                              void mutate(
                                `/api/frames/${frame.id}`,
                                {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ usePreviousFrameAsReference: checked }),
                                },
                                "Frame updated",
                              );
                            }}
                            onApproveVersion={(versionId) => void approveVersion("frame", versionId)}
                          />

                          {transition && shouldShowTransition(transition) ? (
                            <TransitionQueueCard
                              transition={transition}
                              selected={selectedTransitionId === transition.id}
                              reorderMode={reorderMode}
                              promptValue={
                                selectedTransitionId === transition.id && activeEditor === "transitionPrompt"
                                  ? transitionPromptDraft
                                  : transition.transitionPrompt
                              }
                              detailsExpanded={expandedDetails[detailsKey("transition", transition.id)] ?? false}
                              onSelect={() => selectTransition(transition.id)}
                              onPrimaryAction={() => void runTransitionPrimaryAction(transition)}
                              onDelete={() => void deleteTransition(transition.id)}
                              onMovePair={() => {
                                setSegmentMoveTarget(transition);
                                setSegmentIndex(transition.fromFrame.position + 1);
                              }}
                              onZoom={setZoomTarget}
                              onPromptChange={setTransitionPromptDraft}
                              onPromptFocus={() => {
                                setTransitionPromptDraft(transition.transitionPrompt);
                                setActiveEditor("transitionPrompt");
                              }}
                              onPromptCommit={(value) => void commitTransitionPrompt(transition, value)}
                              onToggleDetails={() => toggleDetails("transition", transition.id)}
                              onApproveVersion={(versionId) => void approveVersion("transition", versionId)}
                            />
                          ) : null}
                        </Stack>
                      );
                    })}
                  </Stack>
                </SortableContext>
              </DndContext>

              {isPending ? <Text c="dimmed">Applying reorder…</Text> : null}
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

      <Modal opened={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Add Frames">
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
          <Button leftSection={<IconSparkles size={16} aria-hidden="true" />} onClick={() => void createFramesFromBulkInput()}>
            Create Frames
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
