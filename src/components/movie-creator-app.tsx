"use client";

import { useEffect, useEffectEvent, useState, useTransition } from "react";
import Image from "next/image";
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Group,
  Loader,
  Modal,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
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
  IconLayoutList,
  IconLayoutSidebarRightExpand,
  IconPlayerPlay,
  IconSparkles,
  IconTrash,
  IconUpload,
  IconWand,
  IconZoomIn,
} from "@tabler/icons-react";
import type {
  FrameView,
  ProjectSnapshot,
  ReorderImpactSummary,
  TransitionView,
} from "@/lib/types";

type ApiResult = ProjectSnapshot & {
  impact?: ReorderImpactSummary;
};

type ReviewTarget =
  | { type: "frame"; frame: FrameView }
  | { type: "transition"; transition: TransitionView }
  | null;

type PromptEditorTarget =
  | { type: "frame"; frame: FrameView }
  | { type: "transition"; transition: TransitionView }
  | null;

type ZoomTarget = {
  src: string;
  alt: string;
  title: string;
};
const WORKSPACE_HEIGHT = "calc(100dvh - var(--app-shell-header-offset) - 2 * var(--app-shell-padding))";
const DEFAULT_PROJECT_PATH =
  process.env.NEXT_PUBLIC_DEFAULT_PROJECT_PATH ?? "/Users/tsilva/Desktop/moviegen";

function assetUrl(relativePath: string | null | undefined) {
  if (!relativePath) {
    return "";
  }

  return `/api/assets?path=${encodeURIComponent(relativePath)}`;
}

function transitionCanGenerate(transition: TransitionView) {
  return (
    transition.promptStatus === "confirmed" &&
    transition.videoStatus !== "queued" &&
    transition.videoStatus !== "generating"
  );
}

function transitionCanConfirm(transition: TransitionView) {
  return transition.promptStatus !== "blocked" && Boolean(transition.transitionPrompt.trim());
}

function transitionHasReviewableVersion(transition: TransitionView) {
  return transition.versions.length > 0;
}

function transitionStatusColor(transition: TransitionView) {
  if (transition.videoStatus === "approved") {
    return "blue";
  }

  if (transition.videoStatus === "stale") {
    return "yellow";
  }

  if (transition.videoStatus === "error") {
    return "red";
  }

  if (transition.videoStatus === "queued" || transition.videoStatus === "generating") {
    return "cyan";
  }

  return "gray";
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data as T;
}

type FrameCardProps = {
  frame: FrameView;
  selected: boolean;
  onSelect: () => void;
  onEditPrompt: () => void;
  onGenerate: () => void;
  onReview: () => void;
  onDelete: () => void;
  onZoom: (target: ZoomTarget) => void;
};

type ZoomableThumbProps = {
  src: string | null | undefined;
  zoomSrc: string | null | undefined;
  alt: string;
  emptyLabel: string;
  sizes: string;
  width: number;
  onZoom: (target: ZoomTarget) => void;
};

function ZoomableThumb({ src, zoomSrc, alt, emptyLabel, sizes, width, onZoom }: ZoomableThumbProps) {
  const previewSrc = src ? assetUrl(src) : "";
  const expandedSrc = zoomSrc ? assetUrl(zoomSrc) : previewSrc;

  return (
    <Box style={{ width, flex: `0 0 ${width}px` }}>
      <Box
        onClick={
          previewSrc
            ? (event) => {
                event.stopPropagation();
                onZoom({ src: expandedSrc, alt, title: alt });
              }
            : undefined
        }
        role={previewSrc ? "button" : undefined}
        aria-label={previewSrc ? `Zoom ${alt}` : undefined}
        style={{
          aspectRatio: "16 / 9",
          width: "100%",
          borderRadius: 12,
          overflow: "hidden",
          position: "relative",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.06)",
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
              sizes={sizes}
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
              <IconZoomIn size={12} />
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

function FrameCard({ frame, selected, onSelect, onEditPrompt, onGenerate, onReview, onDelete, onZoom }: FrameCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: frame.id,
  });
  const previewVersion = frame.approvedVersion ?? frame.latestVersion;
  const isGenerating = frame.status === "queued" || frame.status === "generating";
  const statusColor =
    frame.status === "approved"
      ? "teal"
      : frame.status === "error"
        ? "red"
        : isGenerating
          ? "blue"
          : "gray";
  const previewLabel = frame.approvedVersion
    ? "Approved"
    : isGenerating
      ? frame.status === "queued"
        ? "Queued for generation"
        : "Generating image"
    : frame.latestVersion
      ? "Latest candidate"
      : "No image yet";

  return (
    <Card
      ref={setNodeRef}
      shadow="sm"
      radius="lg"
      withBorder
      p="md"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        cursor: isDragging ? "grabbing" : "pointer",
        background: selected ? "rgba(19, 27, 36, 0.95)" : "rgba(15, 20, 28, 0.9)",
        borderColor: selected ? "rgba(78, 201, 240, 0.65)" : "rgba(84, 96, 112, 0.35)",
      }}
      onClick={onSelect}
    >
      <Group align="flex-start" wrap="nowrap" gap="md">
        <Box style={{ position: "relative" }}>
          <ZoomableThumb
            src={previewVersion?.thumbnailPath}
            zoomSrc={previewVersion?.outputPath}
            alt={frame.title || `Frame ${frame.position + 1}`}
            emptyLabel={isGenerating ? "Preparing…" : "No image"}
            sizes="160px"
            width={160}
            onZoom={onZoom}
          />
          {isGenerating ? (
            <Flex
              direction="column"
              gap={4}
              align="center"
              justify="center"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 12,
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
            <Box style={{ minWidth: 0 }}>
              <Text fw={700} size="sm" truncate>
                {frame.title || `Frame ${frame.position + 1}`}
              </Text>
              <Text c="dimmed" size="xs">
                {frame.id}
              </Text>
            </Box>
            <Group gap="xs" wrap="nowrap">
              <Badge color={statusColor}>
                {frame.status}
              </Badge>
              <ActionIcon variant="subtle" color="gray" {...attributes} {...listeners} aria-label="Drag frame">
                <IconArrowsShuffle size={16} />
              </ActionIcon>
            </Group>
          </Group>
          <Text lineClamp={2} size="sm">
            {frame.imagePrompt}
          </Text>
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <Text c="dimmed" size="xs">
              {previewLabel} · {frame.versions.length} candidates
              {isGenerating ? ` · ${frame.queuedJobs} active job${frame.queuedJobs === 1 ? "" : "s"}` : ""}
            </Text>
            <Group gap="xs">
              <Button
                size="compact-sm"
                variant="subtle"
                onClick={(event) => {
                  event.stopPropagation();
                  onEditPrompt();
                }}
              >
                Edit prompt
              </Button>
              <Button
                size="compact-sm"
                variant="light"
                onClick={(event) => {
                  event.stopPropagation();
                  onGenerate();
                }}
                disabled={isGenerating}
              >
                {isGenerating ? "Working..." : "Generate"}
              </Button>
              <Button
                size="compact-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onReview();
                }}
              >
                Review
              </Button>
              <Button
                size="compact-sm"
                color="red"
                variant="subtle"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                Delete
              </Button>
            </Group>
          </Group>
        </Stack>
      </Group>
    </Card>
  );
}

type TransitionCardProps = {
  transition: TransitionView;
  selected: boolean;
  onSelect: () => void;
  onEditPrompt: () => void;
  onConfirmPrompt: () => void;
  onReview: () => void;
  onGenerate: () => void;
  onMovePair: () => void;
  onDelete: () => void;
  onZoom: (target: ZoomTarget) => void;
};

function TransitionCard({
  transition,
  selected,
  onSelect,
  onEditPrompt,
  onConfirmPrompt,
  onReview,
  onGenerate,
  onMovePair,
  onDelete,
  onZoom,
}: TransitionCardProps) {
  const fromPreview = transition.fromFrame.approvedVersion ?? transition.fromFrame.latestVersion;
  const toPreview = transition.toFrame.approvedVersion ?? transition.toFrame.latestVersion;
  const isGenerating =
    transition.videoStatus === "queued" || transition.videoStatus === "generating";

  return (
    <Card
      withBorder
      radius="lg"
      p="md"
      style={{
        background: selected ? "rgba(22, 28, 37, 0.95)" : "rgba(13, 18, 25, 0.88)",
        borderColor:
          transition.videoStatus === "stale" || transition.promptStatus === "needs_confirmation"
            ? "rgba(255, 184, 77, 0.5)"
            : "rgba(84, 96, 112, 0.3)",
        cursor: "pointer",
      }}
      onClick={onSelect}
    >
      <Group align="flex-start" wrap="nowrap" gap="md">
        <SimpleGrid cols={2} spacing="xs" style={{ width: 220, flex: "0 0 220px" }}>
          <ZoomableThumb
            src={fromPreview?.thumbnailPath}
            zoomSrc={fromPreview?.outputPath}
            alt={transition.fromFrame.title || "From frame"}
            emptyLabel="Pending"
            sizes="104px"
            width={104}
            onZoom={onZoom}
          />
          <ZoomableThumb
            src={toPreview?.thumbnailPath}
            zoomSrc={toPreview?.outputPath}
            alt={transition.toFrame.title || "To frame"}
            emptyLabel="Pending"
            sizes="104px"
            width={104}
            onZoom={onZoom}
          />
        </SimpleGrid>
        <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Text fw={600} size="sm" style={{ flex: 1 }} lineClamp={2}>
              {transition.fromFrame.title || "Untitled"} to {transition.toFrame.title || "Untitled"}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Badge color={transition.promptStatus === "confirmed" ? "teal" : "yellow"}>
                {transition.promptStatus}
              </Badge>
              <Badge color={transitionStatusColor(transition)}>
                {transition.videoStatus}
              </Badge>
            </Group>
          </Group>
          <Text c="dimmed" lineClamp={2} size="sm">
            {transition.transitionPrompt || "No transition prompt yet."}
          </Text>
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <Button
              size="compact-sm"
              variant="subtle"
              leftSection={<IconArrowsShuffle size={14} />}
              onClick={(event) => {
                event.stopPropagation();
                onMovePair();
              }}
            >
              Move pair
            </Button>
            <Group gap="xs">
              <Button
                size="compact-sm"
                variant="subtle"
                onClick={(event) => {
                  event.stopPropagation();
                  onEditPrompt();
                }}
              >
                Edit prompt
              </Button>
              {transition.promptStatus !== "confirmed" ? (
                <Button
                  size="compact-sm"
                  variant="light"
                  onClick={(event) => {
                    event.stopPropagation();
                    onConfirmPrompt();
                  }}
                  disabled={!transitionCanConfirm(transition)}
                >
                  Confirm prompt
                </Button>
              ) : null}
              <Button
                size="compact-sm"
                variant="light"
                onClick={(event) => {
                  event.stopPropagation();
                  onGenerate();
                }}
                disabled={!transitionCanGenerate(transition)}
              >
                {isGenerating ? "Working..." : "Generate"}
              </Button>
              <Button
                size="compact-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onReview();
                }}
                disabled={!transitionHasReviewableVersion(transition)}
              >
                Review
              </Button>
              <Button
                size="compact-sm"
                color="red"
                variant="subtle"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                Delete
              </Button>
            </Group>
          </Group>
        </Stack>
      </Group>
    </Card>
  );
}

type ReviewModalProps = {
  target: ReviewTarget;
  onClose: () => void;
  onApprove: (versionId: string) => Promise<void>;
};

function ReviewModal({ target, onClose, onApprove }: ReviewModalProps) {
  if (!target) {
    return null;
  }

  const versions = target.type === "frame" ? target.frame.versions : target.transition.versions;

  return (
    <Modal opened onClose={onClose} size="xl" title={target.type === "frame" ? "Review frame candidates" : "Review transition candidates"}>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        {versions.map((version) => (
          <Card key={version.id} withBorder radius="lg" p="md">
            <Stack gap="sm">
              <Box style={{ aspectRatio: "16 / 9", overflow: "hidden", borderRadius: 12 }}>
                {"thumbnailPath" in version ? (
                  <Box style={{ position: "relative", width: "100%", height: "100%" }}>
                    <Image
                      src={assetUrl(version.thumbnailPath)}
                      alt=""
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
                <Text size="sm">{version.model}</Text>
                <Badge color={version.reviewerDecision === "approved" ? "teal" : "gray"}>
                  {version.reviewerDecision}
                </Badge>
              </Group>
              <Button onClick={() => void onApprove(version.id)}>Approve</Button>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Modal>
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

type PromptEditorModalProps = {
  target: PromptEditorTarget;
  draft: string;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

function PromptEditorModal({
  target,
  draft,
  onDraftChange,
  onClose,
  onSave,
}: PromptEditorModalProps) {
  if (!target) {
    return null;
  }

  const title =
    target.type === "frame"
      ? target.frame.title || `Frame ${target.frame.position + 1}`
      : `${target.transition.fromFrame.title || "Untitled"} to ${target.transition.toFrame.title || "Untitled"}`;

  return (
    <Modal
      opened
      onClose={onClose}
      size="lg"
      title={target.type === "frame" ? "Edit frame prompt" : "Edit transition prompt"}
    >
      <Stack gap="md">
        <Text c="dimmed" size="sm">
          {title}
        </Text>
        <Textarea
          label={target.type === "frame" ? "Image prompt" : "Transition prompt"}
          minRows={8}
          autosize
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave}>Save prompt</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function MovieCreatorApp() {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [projectPath, setProjectPath] = useState(() => {
    if (typeof window === "undefined") {
      return DEFAULT_PROJECT_PATH;
    }

    return window.localStorage.getItem("moviegen:lastProjectPath") || DEFAULT_PROJECT_PATH;
  });
  const [bulkInput, setBulkInput] = useState("");
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget>(null);
  const [promptEditorTarget, setPromptEditorTarget] = useState<PromptEditorTarget>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [zoomTarget, setZoomTarget] = useState<ZoomTarget | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"frame" | "transition">("frame");
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [segmentMoveTarget, setSegmentMoveTarget] = useState<TransitionView | null>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [isPending, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function loadProject(pathValue: string) {
    try {
      const result = await requestJson<ProjectSnapshot>("/api/project/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: pathValue, createIfMissing: true }),
      });
      setSnapshot(result);
      const nextSelectedFrameId =
        result.frames.some((frame) => frame.id === result.manifest.ui.selectedFrameId)
          ? result.manifest.ui.selectedFrameId
          : result.frames[0]?.id ?? null;
      const nextSelectedTransitionId =
        result.transitions.some((transition) => transition.id === result.manifest.ui.selectedTransitionId)
          ? result.manifest.ui.selectedTransitionId
          : result.transitions[0]?.id ?? null;
      setSelectedFrameId(nextSelectedFrameId);
      setSelectedTransitionId(nextSelectedTransitionId);
      setInspectorTab(nextSelectedFrameId ? "frame" : "transition");
      window.localStorage.setItem("moviegen:lastProjectPath", pathValue);
      notifications.show({ color: "teal", message: `Opened ${pathValue}` });
    } catch (error) {
      notifications.show({ color: "red", message: error instanceof Error ? error.message : "Open failed" });
    }
  }

  async function refreshProject() {
    const result = await requestJson<ProjectSnapshot>("/api/project");
    setSnapshot(result);
  }

  const loadProjectEffect = useEffectEvent((pathValue: string) => {
    void loadProject(pathValue);
  });

  useEffect(() => {
    if (!projectPath) {
      return;
    }

    loadProjectEffect(projectPath);
  }, [projectPath]);

  useEffect(() => {
    const hasActiveJobs = snapshot?.manifest.jobs.some(
      (job) => job.status === "queued" || job.status === "running",
    );

    if (!hasActiveJobs) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshProject();
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [snapshot?.manifest.jobs]);

  const frames = snapshot?.frames ?? [];
  const transitions = snapshot?.transitions ?? [];
  const selectedFrame = frames.find((frame) => frame.id === selectedFrameId) ?? frames[0] ?? null;
  const selectedTransition =
    transitions.find((transition) => transition.id === selectedTransitionId) ?? transitions[0] ?? null;
  const selectedFrameIsGenerating =
    selectedFrame?.status === "queued" || selectedFrame?.status === "generating";
  const selectedFrameCanUsePreviousReference = (selectedFrame?.position ?? 0) > 0;
  const selectedTransitionIsGenerating =
    selectedTransition?.videoStatus === "queued" || selectedTransition?.videoStatus === "generating";
  const readyTransitionIds = transitions
    .filter(
      (transition) =>
        transition.promptStatus === "confirmed" &&
        transition.videoStatus !== "approved" &&
        transition.videoStatus !== "queued" &&
        transition.videoStatus !== "generating",
    )
    .map((transition) => transition.id);

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

  function persistUiState(update: Record<string, unknown>) {
    void requestJson<ProjectSnapshot>("/api/project/ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    }).then(setSnapshot).catch(() => {});
  }

  const filter = snapshot?.manifest.ui.filter ?? "all";
  const filteredFrames = frames.filter((frame) => {
    if (filter === "needsAttention") {
      return frame.status !== "approved";
    }
    if (filter === "approved") {
      return frame.status === "approved";
    }
    return true;
  });

  function openPromptEditor(target: PromptEditorTarget) {
    setPromptEditorTarget(target);
    setPromptDraft(
      target
        ? target.type === "frame"
          ? target.frame.imagePrompt
          : target.transition.transitionPrompt
        : "",
    );
  }

  async function savePromptEditor() {
    if (!promptEditorTarget) {
      return;
    }

    const saved =
      promptEditorTarget.type === "frame"
        ? await mutate(
            `/api/frames/${promptEditorTarget.frame.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imagePrompt: promptDraft }),
            },
            "Frame updated",
          )
        : await mutate(
            `/api/transitions/${promptEditorTarget.transition.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transitionPrompt: promptDraft }),
            },
            "Transition updated",
          );

    if (saved) {
      setPromptEditorTarget(null);
      setPromptDraft("");
    }
  }

  async function confirmTransitionPrompt(transitionId: string, prompt: string) {
    return mutate(
      `/api/transitions/${transitionId}/confirm-prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      },
      "Transition confirmed",
    );
  }

  return (
    <>
      <AppShell
        header={{ height: 68 }}
        navbar={{ width: 280, breakpoint: 0 }}
        aside={{ width: 360, breakpoint: 0, collapsed: { desktop: !(snapshot?.manifest.ui.inspectorOpen ?? true) } }}
        padding="md"
      >
        <AppShell.Header px="md">
          <Group h="100%" justify="space-between">
            <Group>
              <Box>
                <Title order={3}>Movie Creator</Title>
                <Text c="dimmed" size="sm">
                  Local-first keyframes, transitions, and review history
                </Text>
              </Box>
            </Group>
            <Group>
              <TextInput
                value={projectPath}
                onChange={(event) => setProjectPath(event.currentTarget.value)}
                placeholder={DEFAULT_PROJECT_PATH}
                w={360}
              />
              <Button leftSection={<IconUpload size={16} />} onClick={() => void loadProject(projectPath)}>
                Open project
              </Button>
              <Tooltip label="Undo last mutation">
                <ActionIcon variant="light" size="lg" onClick={() => void mutate("/api/commands/undo", { method: "POST" }, "Undo complete")}>
                  <IconChevronDown size={16} style={{ transform: "rotate(90deg)" }} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="md" style={{ minHeight: 0, overflowY: "auto" }}>
          <Stack gap="md" h="100%">
            <Card withBorder radius="lg" p="md">
              <Stack gap="sm">
                <Text fw={600}>Bulk frame entry</Text>
                <Textarea
                  minRows={10}
                  maxRows={16}
                  value={bulkInput}
                  onChange={(event) => setBulkInput(event.currentTarget.value)}
                  placeholder="One prompt per line"
                />
                <Button
                  leftSection={<IconSparkles size={16} />}
                  onClick={() => {
                    const rows = bulkInput
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .map((imagePrompt) => ({ imagePrompt }));
                    if (!rows.length) {
                      return;
                    }
                    void mutate(
                      "/api/frames/bulk-create",
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ rows }),
                      },
                      `Created ${rows.length} frames`,
                    );
                    setBulkInput("");
                  }}
                >
                  Create frames
                </Button>
              </Stack>
            </Card>

            <Card withBorder radius="lg" p="md">
              <Stack gap="sm">
                <Text fw={600}>Filters</Text>
                <SegmentedControl
                  fullWidth
                  value={filter}
                  onChange={(value) => persistUiState({ filter: value })}
                  data={[
                    { label: "All", value: "all" },
                    { label: "Attention", value: "needsAttention" },
                    { label: "Approved", value: "approved" },
                  ]}
                />
              </Stack>
            </Card>

            <Card withBorder radius="lg" p="md">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text fw={600}>Batch actions</Text>
                  <Text c="dimmed" size="xs">
                    {frames.length} frames
                  </Text>
                </Group>
                <Button
                  leftSection={<IconWand size={16} />}
                  variant="light"
                  onClick={() =>
                    void mutate(
                      "/api/frames/bulk-generate",
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ frameIds: frames.map((frame) => frame.id), candidateCount: 1 }),
                      },
                      "Queued frame generation",
                    )
                  }
                  disabled={!frames.length}
                >
                  Generate all frames
                </Button>
	                <Button
	                  leftSection={<IconPlayerPlay size={16} />}
	                  variant="light"
                  onClick={() =>
                    void mutate(
                      "/api/transitions/bulk-generate",
                      {
                        method: "POST",
	                        headers: { "Content-Type": "application/json" },
	                        body: JSON.stringify({
	                          transitionIds: readyTransitionIds,
	                        }),
	                      },
	                      "Queued transition generation",
	                    )
	                  }
	                  disabled={!readyTransitionIds.length}
	                >
	                  Generate ready transitions
	                </Button>
                <Button variant="subtle" onClick={() => void refreshProject()}>
                  Refresh
                </Button>
              </Stack>
            </Card>
          </Stack>
        </AppShell.Navbar>

        <AppShell.Aside p="md" style={{ minHeight: 0, overflowY: "auto" }}>
          <Stack gap="md" h="100%">
            <Group justify="space-between">
              <Text fw={600}>Inspector</Text>
              <ActionIcon
                variant="light"
                onClick={() => persistUiState({ inspectorOpen: false })}
                aria-label="Collapse inspector"
              >
                <IconLayoutSidebarRightExpand size={16} />
              </ActionIcon>
            </Group>

            <Tabs value={inspectorTab} onChange={(value) => setInspectorTab((value as "frame" | "transition") ?? "frame")} flex={1}>
              <Tabs.List>
                <Tabs.Tab value="frame" leftSection={<IconLayoutList size={14} />}>
                  Frame
                </Tabs.Tab>
                <Tabs.Tab value="transition" leftSection={<IconPlayerPlay size={14} />}>
                  Transition
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="frame" pt="md">
                {selectedFrame ? (
                  <Stack gap="sm">
                    <TextInput
                      label="Title"
                      value={selectedFrame.title}
                      onChange={(event) =>
                        setSnapshot((current) =>
                          current
                            ? {
                                ...current,
                                frames: current.frames.map((frame) =>
                                  frame.id === selectedFrame.id ? { ...frame, title: event.currentTarget.value } : frame,
                                ),
                              }
                            : current,
                        )
                      }
                      onBlur={(event) =>
                        void mutate(
                          `/api/frames/${selectedFrame.id}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ title: event.currentTarget.value }),
                          },
                          "Frame updated",
                        )
                      }
                    />
                    <Textarea
                      label="Image prompt"
                      minRows={6}
                      value={selectedFrame.imagePrompt}
                      onChange={(event) =>
                        setSnapshot((current) =>
                          current
                            ? {
                                ...current,
                                frames: current.frames.map((frame) =>
                                  frame.id === selectedFrame.id ? { ...frame, imagePrompt: event.currentTarget.value } : frame,
                                ),
                              }
                            : current,
                        )
                      }
                      onBlur={(event) =>
                        void mutate(
                          `/api/frames/${selectedFrame.id}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ imagePrompt: event.currentTarget.value }),
                          },
                          "Frame updated",
                        )
                      }
                    />
                    <Textarea
                      label="Notes"
                      minRows={4}
                      value={selectedFrame.notes}
                      onChange={(event) =>
                        setSnapshot((current) =>
                          current
                            ? {
                                ...current,
                                frames: current.frames.map((frame) =>
                                  frame.id === selectedFrame.id ? { ...frame, notes: event.currentTarget.value } : frame,
                                ),
                              }
                            : current,
                        )
                      }
                      onBlur={(event) =>
                        void mutate(
                          `/api/frames/${selectedFrame.id}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ notes: event.currentTarget.value }),
                          },
                          "Frame updated",
                        )
                      }
                    />
                    <Switch
                      label="Use previous frame as reference"
                      checked={selectedFrame.usePreviousFrameAsReference}
                      disabled={!selectedFrameCanUsePreviousReference}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSnapshot((current) =>
                          current
                            ? {
                                ...current,
                                manifest: {
                                  ...current.manifest,
                                  frames: current.manifest.frames.map((frame) =>
                                    frame.id === selectedFrame.id
                                      ? { ...frame, usePreviousFrameAsReference: checked }
                                      : frame,
                                  ),
                                },
                                frames: current.frames.map((frame) =>
                                  frame.id === selectedFrame.id
                                    ? { ...frame, usePreviousFrameAsReference: checked }
                                    : frame,
                                ),
                              }
                            : current,
                        );
                        void mutate(
                          `/api/frames/${selectedFrame.id}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ usePreviousFrameAsReference: checked }),
                          },
                          "Frame updated",
                        );
                      }}
                    />
                    <Text c="dimmed" size="xs">
                      {selectedFrameCanUsePreviousReference
                        ? "When enabled, generation uses the previous frame's approved image, or its latest candidate if nothing is approved yet."
                        : "The first frame has no previous frame to anchor to."}
                    </Text>
                    <Group grow>
                      <Button
                        onClick={() =>
                          void mutate(
                            `/api/frames/${selectedFrame.id}/generate`,
                            { method: "POST" },
                            "Queued frame generation",
                          )
                        }
                        disabled={selectedFrameIsGenerating}
                      >
                        {selectedFrameIsGenerating ? "Generating…" : "Generate"}
                      </Button>
                      <Button variant="light" onClick={() => setReviewTarget({ type: "frame", frame: selectedFrame })}>
                        Review
                      </Button>
                    </Group>
                    <Button
                      color="red"
                      variant="light"
                      leftSection={<IconTrash size={16} />}
                      onClick={() => void deleteFrame(selectedFrame.id)}
                    >
                      Delete frame
                    </Button>
                  </Stack>
                ) : (
                  <Text c="dimmed" size="sm">
                    Select a frame to edit title, prompt, and notes.
                  </Text>
                )}
              </Tabs.Panel>

	              <Tabs.Panel value="transition" pt="md">
	                {selectedTransition ? (
	                  <Stack gap="sm">
	                    {selectedTransition.approvedVideoVersion ?? selectedTransition.latestVideoVersion ? (
	                      <Box
	                        style={{
	                          aspectRatio: "16 / 9",
	                          overflow: "hidden",
	                          borderRadius: 12,
	                          background: "rgba(255,255,255,0.04)",
	                        }}
	                      >
	                        <video
	                          controls
	                          playsInline
	                          preload="metadata"
	                          poster={assetUrl(
	                            (selectedTransition.approvedVideoVersion ?? selectedTransition.latestVideoVersion)
	                              ?.posterPath,
	                          ) || undefined}
	                          src={assetUrl(
	                            (selectedTransition.approvedVideoVersion ?? selectedTransition.latestVideoVersion)
	                              ?.outputPath,
	                          )}
	                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
	                        />
	                      </Box>
	                    ) : null}
	                    <Textarea
	                      label="Transition prompt"
	                      minRows={6}
                      value={selectedTransition.transitionPrompt}
                      onChange={(event) =>
                        setSnapshot((current) =>
                          current
                            ? {
                                ...current,
                                transitions: current.transitions.map((transition) =>
                                  transition.id === selectedTransition.id
                                    ? { ...transition, transitionPrompt: event.currentTarget.value }
                                    : transition,
                                ),
                              }
                            : current,
                        )
                      }
                      onBlur={(event) =>
                        void mutate(
                          `/api/transitions/${selectedTransition.id}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ transitionPrompt: event.currentTarget.value }),
                          },
                          "Transition updated",
                        )
                      }
                    />
	                    <Group>
	                      <Badge color={selectedTransition.promptStatus === "confirmed" ? "teal" : "yellow"}>
	                        {selectedTransition.promptStatus}
	                      </Badge>
	                      <Badge color={transitionStatusColor(selectedTransition)}>
	                        {selectedTransition.videoStatus}
	                      </Badge>
	                    </Group>
                    <Group grow>
                      <Button
                        variant="subtle"
                        onClick={() => void confirmTransitionPrompt(selectedTransition.id, selectedTransition.transitionPrompt)}
                        disabled={!transitionCanConfirm(selectedTransition)}
                      >
                        Confirm prompt
                      </Button>
	                      <Button
	                        onClick={() =>
	                          void mutate(
                            "/api/transitions/bulk-generate",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ transitionIds: [selectedTransition.id] }),
                            },
	                            "Queued transition generation",
	                          )
	                        }
	                        disabled={!transitionCanGenerate(selectedTransition)}
	                      >
	                        {selectedTransitionIsGenerating ? "Generating…" : "Generate"}
	                      </Button>
                      <Button
                        variant="light"
                        onClick={() => setReviewTarget({ type: "transition", transition: selectedTransition })}
                        disabled={!transitionHasReviewableVersion(selectedTransition)}
                      >
                        Review
                      </Button>
                    </Group>
                    {!transitionHasReviewableVersion(selectedTransition) ? (
                      <Text c="dimmed" size="sm">
                        No transition video candidates yet. Confirm the prompt, then generate one before reviewing.
                      </Text>
                    ) : null}
                    <Button
                      color="red"
                      variant="light"
                      leftSection={<IconTrash size={16} />}
                      onClick={() => void deleteTransition(selectedTransition.id)}
                    >
                      Delete transition
                    </Button>
                  </Stack>
                ) : (
                  <Text c="dimmed" size="sm">
                    Select a transition to edit and confirm the prompt before generating video.
                  </Text>
                )}
              </Tabs.Panel>
            </Tabs>
          </Stack>
        </AppShell.Aside>

        <AppShell.Main style={{ minHeight: 0, overflow: "hidden" }}>
          <ScrollArea
            h={WORKSPACE_HEIGHT}
            offsetScrollbars="y"
            scrollbarSize={10}
            type="scroll"
            styles={{ viewport: { overscrollBehavior: "contain" } }}
          >
            {!snapshot ? (
              <Flex h={WORKSPACE_HEIGHT} align="center" justify="center">
                <Card withBorder radius="xl" p="xl" maw={560}>
                  <Stack gap="md">
                    <Title order={2}>Open a local project directory</Title>
                    <Text c="dimmed">
                      The app stores its manifest and generated media directly inside the chosen folder.
                    </Text>
                    <TextInput
                      value={projectPath}
                      onChange={(event) => setProjectPath(event.currentTarget.value)}
                      placeholder={DEFAULT_PROJECT_PATH}
                    />
                    <Button onClick={() => void loadProject(projectPath)}>Open or create project</Button>
                  </Stack>
                </Card>
              </Flex>
            ) : (
              <Stack gap="md" pb="md">
                <Group justify="space-between">
                  <Group>
                    <Title order={2}>Sequence editor</Title>
                    <Badge variant="light">{filteredFrames.length} visible frames</Badge>
                  </Group>
                  <Group>
                    <Button
                      variant="subtle"
                      onClick={() => persistUiState({ inspectorOpen: !(snapshot.manifest.ui.inspectorOpen ?? true) })}
                    >
                      Toggle inspector
                    </Button>
                  </Group>
                </Group>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => {
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
                      {filteredFrames.map((frame, index) => {
                        const transition = transitions.find((item) => item.fromFrameId === frame.id);
                        return (
                          <Stack key={frame.id} gap="sm">
                            <FrameCard
                              frame={frame}
                              selected={selectedFrameId === frame.id}
                              onSelect={() => {
                                setSelectedFrameId(frame.id);
                                setSelectedTransitionId(null);
                                setInspectorTab("frame");
                                persistUiState({ selectedFrameId: frame.id, selectedTransitionId: null });
                              }}
                              onEditPrompt={() => {
                                setSelectedFrameId(frame.id);
                                setSelectedTransitionId(null);
                                setInspectorTab("frame");
                                openPromptEditor({ type: "frame", frame });
                              }}
                              onGenerate={() =>
                                void mutate(
                                  `/api/frames/${frame.id}/generate`,
                                  { method: "POST" },
                                  "Queued frame generation",
                                )
                              }
                              onReview={() => setReviewTarget({ type: "frame", frame })}
                              onDelete={() => void deleteFrame(frame.id)}
                              onZoom={setZoomTarget}
                            />
                          {index < filteredFrames.length - 1 && transition ? (
                            <TransitionCard
                              transition={transition}
                              selected={selectedTransitionId === transition.id}
                              onSelect={() => {
                                setSelectedTransitionId(transition.id);
                                setSelectedFrameId(null);
                                setInspectorTab("transition");
                                persistUiState({ selectedTransitionId: transition.id, selectedFrameId: null });
                              }}
                              onEditPrompt={() => {
                                setSelectedTransitionId(transition.id);
                                setSelectedFrameId(null);
                                setInspectorTab("transition");
                                openPromptEditor({ type: "transition", transition });
                              }}
                              onConfirmPrompt={() => void confirmTransitionPrompt(transition.id, transition.transitionPrompt)}
                              onReview={() => setReviewTarget({ type: "transition", transition })}
                              onGenerate={() =>
                                void mutate(
                                  "/api/transitions/bulk-generate",
                                  {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ transitionIds: [transition.id] }),
                                  },
                                  "Queued transition generation",
                                )
                              }
                              onMovePair={() => {
                                setSegmentMoveTarget(transition);
                                setSegmentIndex(index + 1);
                              }}
                              onDelete={() => void deleteTransition(transition.id)}
                              onZoom={setZoomTarget}
                            />
                          ) : null}
                          </Stack>
                        );
                      })}
                    </Stack>
                  </SortableContext>
                </DndContext>
                {isPending ? <Text c="dimmed">Applying reorder...</Text> : null}
              </Stack>
            )}
          </ScrollArea>
        </AppShell.Main>
      </AppShell>

      <ReviewModal
        target={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onApprove={async (versionId) => {
          if (!reviewTarget) {
            return;
          }

          const url =
            reviewTarget.type === "frame"
              ? `/api/frame-versions/${versionId}/approve`
              : `/api/transition-versions/${versionId}/approve`;

          await mutate(url, { method: "POST" }, "Approved version");
          setReviewTarget(null);
        }}
      />
      <PromptEditorModal
        target={promptEditorTarget}
        draft={promptDraft}
        onDraftChange={setPromptDraft}
        onClose={() => {
          setPromptEditorTarget(null);
          setPromptDraft("");
        }}
        onSave={() => {
          void savePromptEditor();
        }}
      />
      <ZoomModal target={zoomTarget} onClose={() => setZoomTarget(null)} />

      <Modal
        opened={Boolean(segmentMoveTarget)}
        onClose={() => setSegmentMoveTarget(null)}
        title="Move segment"
      >
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
            Move pair
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
