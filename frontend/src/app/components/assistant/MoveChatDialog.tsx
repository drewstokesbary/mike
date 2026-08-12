"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderInput, MessageSquare } from "lucide-react";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { listProjects } from "@/app/lib/mikeApi";
import type { Chat, Project } from "@/app/components/shared/types";
import { Modal } from "@/app/components/modals/Modal";
import { SearchBar } from "@/app/components/ui/search-bar";
import {
    APP_SURFACE_ACTIVE_CLASS,
    APP_SURFACE_HOVER_CLASS,
} from "@/app/components/ui/liquid-surface";

interface Props {
    chat: Chat;
    open: boolean;
    onClose: () => void;
    onMoved?: (projectId: string | null) => void;
}

export function MoveChatDialog({ chat, open, onClose, onMoved }: Props) {
    const { moveChat } = useChatHistoryContext();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(false);
    const [moving, setMoving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(
        chat.project_id,
    );

    useEffect(() => {
        if (!open) return;
        setSelectedId(chat.project_id);
        setSearch("");
        setError(null);
        setLoading(true);
        listProjects()
            .then(setProjects)
            .catch(() => setError("Projects could not be loaded."))
            .finally(() => setLoading(false));
    }, [chat.project_id, open]);

    const filteredProjects = useMemo(() => {
        const query = search.trim().toLowerCase();
        return query
            ? projects.filter((project) =>
                  project.name.toLowerCase().includes(query),
              )
            : projects;
    }, [projects, search]);
    const selectedProject = projects.find(
        (project) => project.id === selectedId,
    );
    const sharesDestination =
        !!selectedProject && selectedProject.shared_with.length > 0;
    const unchanged = selectedId === chat.project_id;

    async function handleMove() {
        if (unchanged) return;
        setMoving(true);
        setError(null);
        try {
            await moveChat(chat.id, selectedId);
            onMoved?.(selectedId);
            onClose();
        } catch {
            setError("The chat could not be moved. Please try again.");
        } finally {
            setMoving(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            breadcrumbs={["Assistant History", "Move Chat"]}
            primaryAction={{
                label: moving ? "Moving…" : "Move chat",
                onClick: handleMove,
                disabled: loading || moving || unchanged,
            }}
        >
            <div className="pt-1 pb-2">
                <SearchBar
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Search projects..."
                    autoFocus
                />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-2 text-xs">
                <p className="px-2 py-2 font-medium text-gray-400">
                    Destination
                </p>
                <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${selectedId === null ? APP_SURFACE_ACTIVE_CLASS : APP_SURFACE_HOVER_CLASS}`}
                >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>General Assistant</span>
                </button>
                {loading ? (
                    <p className="px-2 py-4 text-gray-400">Loading projects…</p>
                ) : (
                    filteredProjects.map((project) => (
                        <button
                            type="button"
                            key={project.id}
                            onClick={() => setSelectedId(project.id)}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${selectedId === project.id ? APP_SURFACE_ACTIVE_CLASS : APP_SURFACE_HOVER_CLASS}`}
                        >
                            <FolderInput className="h-3.5 w-3.5" />
                            <span className="min-w-0 flex-1 truncate">
                                {project.name}
                            </span>
                        </button>
                    ))
                )}
                {sharesDestination && (
                    <div className="mx-2 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                        Members of this shared project will be able to see the
                        chat after it is moved.
                    </div>
                )}
                {error && (
                    <p className="px-2 pt-3 text-red-600" role="alert">
                        {error}
                    </p>
                )}
            </div>
        </Modal>
    );
}
