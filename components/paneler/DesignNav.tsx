"use client";

import { useState } from "react";
import {
  Copy,
  MoreHorizontal,
  Plus,
  Send,
  Star,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// Button is used for the "+ New Design" CTA only; per-row triggers use the
// raw Base UI Trigger element (asChild isn't supported on Base UI).
import type { DesignRow } from "@/lib/useDesigns";

interface DesignNavProps {
  designs: DesignRow[];
  currentId: string | null;
  loading: boolean;
  onCreate: () => void;
  onLoad: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onToggleStarred: (id: string) => Promise<void>;
  onTogglePublished: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function DesignNav({
  designs,
  currentId,
  loading,
  onCreate,
  onLoad,
  onRename,
  onToggleStarred,
  onTogglePublished,
  onDelete,
}: DesignNavProps) {
  const starred = designs.filter((d) => d.starred);
  const recents = designs.filter((d) => !d.starred);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[color-mix(in_oklab,var(--foreground)_8%,transparent)] bg-[var(--workspace)]">
      {/* Header — small word-mark, no logo image (Paneler doesn't have one in-app). */}
      <header className="flex items-center px-4 py-3 border-b border-[color-mix(in_oklab,var(--foreground)_8%,transparent)]">
        <span className="font-heading text-lg uppercase tracking-[0.2em]">
          Paneler
        </span>
      </header>

      {/* New Design button */}
      <div className="p-3">
        <Button onClick={onCreate} className="w-full">
          <Plus className="mr-2 h-4 w-4" />
          New Design
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            Loading designs…
          </div>
        ) : designs.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No designs yet
          </div>
        ) : (
          <>
            {starred.length > 0 && (
              <NavSection title="Starred">
                {starred.map((d) => (
                  <NavRow
                    key={d.id}
                    design={d}
                    active={currentId === d.id}
                    onLoad={onLoad}
                    onRename={onRename}
                    onToggleStarred={onToggleStarred}
                    onTogglePublished={onTogglePublished}
                    onDelete={onDelete}
                  />
                ))}
              </NavSection>
            )}
            <NavSection title="Recents">
              {recents.map((d) => (
                <NavRow
                  key={d.id}
                  design={d}
                  active={currentId === d.id}
                  onLoad={onLoad}
                  onRename={onRename}
                  onToggleStarred={onToggleStarred}
                  onTogglePublished={onTogglePublished}
                  onDelete={onDelete}
                />
              ))}
            </NavSection>
          </>
        )}
      </div>
    </aside>
  );
}

function NavSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-3">
      <h3 className="px-3 py-2 font-heading text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

interface NavRowProps {
  design: DesignRow;
  active: boolean;
  onLoad: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onToggleStarred: (id: string) => Promise<void>;
  onTogglePublished: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function NavRow({
  design,
  active,
  onLoad,
  onRename,
  onToggleStarred,
  onTogglePublished,
  onDelete,
}: NavRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(design.name);

  const commitRename = async () => {
    const trimmed = draftName.trim();
    setRenaming(false);
    if (trimmed && trimmed !== design.name) {
      await onRename(design.id, trimmed);
    } else {
      setDraftName(design.name);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !renaming && onLoad(design.id)}
      onKeyDown={(e) => {
        if (!renaming && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onLoad(design.id);
        }
      }}
      className={`group relative flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors ${
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/40 text-muted-foreground hover:text-foreground"
      }`}
    >
      <div className="min-w-0 flex-1 flex items-center gap-2">
        {design.starred && (
          <Star className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400" />
        )}
        {design.published && (
          <Send className="h-3 w-3 shrink-0 text-emerald-400" />
        )}
        {renaming ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraftName(design.name);
                setRenaming(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-sm font-medium outline-none border-b border-current"
          />
        ) : (
          <span className="truncate text-sm font-medium">{design.name}</span>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Design actions"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          <MoreHorizontal className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
          >
            <Copy className="mr-2 h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              void onToggleStarred(design.id);
            }}
          >
            <Star className="mr-2 h-4 w-4" />
            {design.starred ? "Unstar" : "Star"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              void onTogglePublished(design.id);
            }}
          >
            <Send className="mr-2 h-4 w-4" />
            {design.published ? "Unpublish" : "Publish"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              void onDelete(design.id);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
