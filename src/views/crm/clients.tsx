"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Archive, ArchiveRestore, Building2, ChevronLeft, ChevronRight, FolderKanban, Globe,
  KeyRound, LifeBuoy, Loader2, Mail, MapPin, Pencil, Phone, Plus, Power, Receipt, Search, Star, Trash2, UserPlus, X,
} from "lucide-react";
import { PageHeader, EmptyState, ErrorState, StatusBadge, Field, ListSkeleton } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api, qs, formatDate } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import type { ViewProps } from "@/views/registry";
import { ActivityTimeline, type ActivityItem, type FollowUpItem } from "@/views/crm/lead-detail";

// ============ Types ============

type ClientRow = {
  id: string;
  clientNumber: string;
  companyName: string;
  industry: string | null;
  location: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  _count?: { projects: number; invoices: number; tickets: number };
};

type Contact = {
  id: string;
  clientId: string;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  preferredMethod: string | null;
  isPrimary: boolean;
  notes: string | null;
};

type ClientDetail = ClientRow & {
  archivedAt: string | null;
  contacts: Contact[];
  projects: { id: string; name: string; projectNumber: string; status: string; progress: number; deadline: string | null; type: string }[];
  invoices: { id: string; invoiceNumber: string; total: number; status: string; issueDate: string }[];
  tickets: { id: string; subject: string; status: string; priority: string; createdAt: string }[];
  followUps: FollowUpItem[];
};

type ClientsResponse = { items: ClientRow[]; total: number; page: number; pageSize: number };
type ClientDetailResponse = { client: ClientDetail; activities: ActivityItem[] };

type PortalUserRow = {
  id: string; name: string; email: string; avatarColor: string;
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
};

const CLIENT_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;

// ============ View ============

export function ClientsView({ navigate, entityId }: ViewProps) {
  const { data: session } = useSession();
  const permissions = session?.user?.permissions ?? [];
  const { toast } = useToast();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [data, setData] = useState<ClientsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editClient, setEditClient] = useState<ClientRow | null>(null);

  // Auto-open entity from global search
  useEffect(() => {
    if (entityId) { setDetailId(entityId); setDetailOpen(true); }
  }, [entityId]);
  const [archiveTarget, setArchiveTarget] = useState<ClientDetail | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<ClientsResponse>(`/api/clients${qs({ q: debouncedQ, status, page, pageSize })}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, status, page]);

  useEffect(() => { load(); }, [load]);

  const hasFilters = debouncedQ !== "" || status !== "";
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Every company you serve — one source of truth with complete business history."
        actions={permissions.includes("clients.create") ? (
          <Button onClick={() => setFormOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Client</Button>
        ) : undefined}
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 mb-5">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company, number, email, phone…"
            className="pl-9 h-9 bg-secondary/50"
            aria-label="Search clients"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={status || "ALL"} onValueChange={(v) => { setStatus(v === "ALL" ? "" : v); setPage(1); }}>
            <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {CLIENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={() => { setQ(""); setStatus(""); setPage(1); }}>
              <X className="w-4 h-4 mr-1.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      {loading && <ListSkeleton rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState
          icon={<Building2 className="w-5 h-5" />}
          title={hasFilters ? "No clients match your filters" : "No clients yet"}
          description={hasFilters ? "Try adjusting or clearing the filters." : "Win a lead and convert it, or create a client manually."}
          action={
            hasFilters ? (
              <Button variant="outline" onClick={() => { setQ(""); setStatus(""); setPage(1); }}>Clear filters</Button>
            ) : permissions.includes("clients.create") ? (
              <Button onClick={() => setFormOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Client</Button>
            ) : undefined
          }
        />
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.items.map((client) => (
              <button
                key={client.id}
                onClick={() => { setDetailId(client.id); setDetailOpen(true); }}
                className="apex-panel p-4 text-left hover:border-primary/40 transition-colors flex flex-col gap-3"
                aria-label={`Open client ${client.companyName}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{client.companyName}</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5" dir="ltr">{client.clientNumber}</p>
                  </div>
                  <StatusBadge status={client.status} />
                </div>
                {client.industry && (
                  <p className="text-xs text-muted-foreground truncate -mt-1.5">
                    {client.industry}{client.location ? ` · ${client.location}` : ""}
                  </p>
                )}
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/70 border border-border">
                    <FolderKanban className="w-3 h-3" /> {client._count?.projects ?? 0} projects
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/70 border border-border">
                    <Receipt className="w-3 h-3" /> {client._count?.invoices ?? 0} invoices
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/70 border border-border">
                    <LifeBuoy className="w-3 h-3" /> {client._count?.tickets ?? 0} tickets
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-auto">Created {formatDate(client.createdAt)}</p>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 mt-5">
            <p className="text-xs text-muted-foreground">Page {data.page} of {totalPages} · {data.total} client{data.total === 1 ? "" : "s"}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Prev
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Detail drawer */}
      <ClientDetailDrawer
        clientId={detailId}
        open={detailOpen}
        refreshSignal={detailRefresh}
        onOpenChange={setDetailOpen}
        onChanged={load}
        navigate={navigate}
        permissions={permissions}
        onEdit={(c) => setEditClient(c)}
        onArchiveRequest={setArchiveTarget}
      />

      {/* New client */}
      <ClientFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={load} />

      {/* Edit client */}
      {editClient && (
        <ClientFormDialog
          open
          onOpenChange={(o) => !o && setEditClient(null)}
          client={editClient}
          onSaved={() => { load(); setDetailRefresh((k) => k + 1); }}
        />
      )}

      {/* Archive confirmation */}
      <AlertDialog open={archiveTarget !== null} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this client?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget?.companyName} will be moved to the archive. Historical projects and invoices stay intact. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!archiveTarget) return;
                const target = archiveTarget;
                api.delete(`/api/clients/${target.id}`)
                  .then(() => { toast({ title: "Client archived", description: target.companyName }); setArchiveTarget(null); load(); })
                  .catch((err) => { toast({ title: "Could not archive", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" }); setArchiveTarget(null); });
              }}
            >
              Archive client
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ Detail drawer ============

function ClientDetailDrawer({
  clientId, open, refreshSignal, onOpenChange, onChanged, navigate, permissions, onEdit, onArchiveRequest,
}: {
  clientId: string | null;
  open: boolean;
  refreshSignal?: number;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
  navigate: (p: string) => void;
  permissions: string[];
  onEdit: (client: ClientDetail) => void;
  onArchiveRequest: (client: ClientDetail) => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<ClientDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactDialog, setContactDialog] = useState<{ mode: "new" | "edit"; contact?: Contact } | null>(null);
  const [contactDelete, setContactDelete] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);

  const canEdit = permissions.includes("clients.edit");
  const canDelete = permissions.includes("clients.delete");
  const canContactsCreate = permissions.includes("contacts.create");
  const canContactsEdit = permissions.includes("contacts.edit");
  const canContactsDelete = permissions.includes("contacts.delete");

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<ClientDetailResponse>(`/api/clients/${clientId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this client.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (open && clientId) load();
    if (!open) setData(null);
  }, [open, clientId, refreshSignal, load]);

  const client = data?.client;

  const toggleArchive = async () => {
    if (!client) return;
    if (client.status !== "ARCHIVED" && canDelete) {
      onArchiveRequest(client);
      return;
    }
    if (client.status === "ARCHIVED" && canEdit) {
      setBusy(true);
      try {
        await api.patch(`/api/clients/${client.id}`, { status: "ACTIVE" });
        toast({ title: "Client restored", description: client.companyName });
        await load();
        onChanged();
      } catch (err) {
        toast({ title: "Restore failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
      } finally {
        setBusy(false);
      }
    }
  };

  const deleteContact = () => {
    if (!contactDelete) return;
    const target = contactDelete;
    api.delete(`/api/contacts/${target.id}`)
      .then(() => { toast({ title: "Contact removed", description: target.name }); setContactDelete(null); load(); onChanged(); })
      .catch((err) => { toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" }); setContactDelete(null); });
  };

  const projectsTotal = client?.projects.length ?? 0;
  const openTickets = useMemo(() => (client?.tickets ?? []).filter((t) => !["RESOLVED", "CLOSED"].includes(t.status)).length, [client]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-[520px] p-0 flex flex-col">
          {loading && !client && <div className="p-5"><ListSkeleton rows={8} /></div>}
          {!loading && error && <div className="p-5"><ErrorState message={error} onRetry={load} /></div>}

          {client && (
            <>
              <SheetHeader className="border-b border-border pb-4">
                <div className="flex items-start justify-between gap-3 pr-8">
                  <div className="min-w-0">
                    <SheetTitle className="truncate text-base">{client.companyName}</SheetTitle>
                    <SheetDescription className="text-xs font-mono" dir="ltr">{client.clientNumber}</SheetDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusBadge status={client.status} />
                    <span className="text-[11px] text-muted-foreground">Created {formatDate(client.createdAt)}</span>
                  </div>
                </div>
                {(canEdit || canDelete) && (
                  <div className="flex gap-2 mt-2">
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => onEdit(client)}>
                        <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                      </Button>
                    )}
                    {client.status === "ARCHIVED" && canEdit && (
                      <Button size="sm" variant="outline" onClick={toggleArchive} disabled={busy}>
                        {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ArchiveRestore className="w-3.5 h-3.5 mr-1.5" />}
                        Restore
                      </Button>
                    )}
                    {client.status !== "ARCHIVED" && canDelete && (
                      <Button size="sm" variant="outline" className="text-rose-300" onClick={toggleArchive}>
                        <Archive className="w-3.5 h-3.5 mr-1.5" /> Archive
                      </Button>
                    )}
                  </div>
                )}
              </SheetHeader>

              <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
                <TabsList className="mx-4 mt-3 w-fit">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="projects">Projects{projectsTotal > 0 ? ` (${projectsTotal})` : ""}</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <ScrollArea className="flex-1 min-h-0">
                  {/* Overview */}
                  <TabsContent value="overview" className="px-5 py-4 mt-0">
                    <div className="divide-y divide-border/60">
                      <DetailRow icon={<Mail className="w-3.5 h-3.5" />} label="Email" value={client.email ? <span dir="ltr">{client.email}</span> : "—"} />
                      <DetailRow icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={client.phone ? <span dir="ltr">{client.phone}</span> : "—"} />
                      <DetailRow icon={<Globe className="w-3.5 h-3.5" />} label="Website" value={client.website ? <span dir="ltr" className="break-all">{client.website}</span> : "—"} />
                      <DetailRow icon={<MapPin className="w-3.5 h-3.5" />} label="Location" value={client.location || "—"} />
                      <DetailRow icon={null} label="Industry" value={client.industry || "—"} />
                    </div>

                    <Separator className="my-4" />

                    {/* Contacts */}
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium">Contacts ({client.contacts.length})</p>
                      {canContactsCreate && (
                        <Button size="sm" variant="outline" onClick={() => setContactDialog({ mode: "new" })}>
                          <Plus className="w-3.5 h-3.5 mr-1.5" /> Add
                        </Button>
                      )}
                    </div>
                    {client.contacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-5 border border-dashed border-border rounded-lg">No contacts yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {client.contacts.map((c) => (
                          <div key={c.id} className="rounded-lg border border-border p-3 bg-card/50 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium">{c.name}</p>
                                {c.isPrimary && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                                    <Star className="w-3 h-3" /> PRIMARY
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {[c.position, c.email, c.phone, c.preferredMethod].filter(Boolean).join(" · ") || "No details"}
                              </p>
                            </div>
                            {(canContactsEdit || canContactsDelete) && (
                              <div className="flex items-center gap-1 shrink-0">
                                {canContactsEdit && (
                                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${c.name}`} onClick={() => setContactDialog({ mode: "edit", contact: c })}>
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {canContactsDelete && (
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-300" aria-label={`Remove ${c.name}`} onClick={() => setContactDelete(c)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Portal access (§72) */}
                    <Separator className="my-4" />
                    <PortalAccessSection clientId={client.id} canEdit={canEdit} />

                    {/* Mini stats */}
                    <Separator className="my-4" />
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-secondary/40 border border-border p-3 text-center">
                        <p className="text-lg font-semibold">{projectsTotal}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Projects</p>
                      </div>
                      <div className="rounded-lg bg-secondary/40 border border-border p-3 text-center">
                        <p className="text-lg font-semibold">{client.invoices.length}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Invoices</p>
                      </div>
                      <div className="rounded-lg bg-secondary/40 border border-border p-3 text-center">
                        <p className="text-lg font-semibold">{openTickets}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Open tickets</p>
                      </div>
                    </div>

                    {client.notes && (
                      <>
                        <Separator className="my-4" />
                        <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
                        <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
                      </>
                    )}
                  </TabsContent>

                  {/* Projects */}
                  <TabsContent value="projects" className="px-5 py-4 mt-0 space-y-2">
                    {projectsTotal === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No projects for this client yet.</p>
                    ) : (
                      client.projects.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => navigate("projects")}
                          className="w-full text-left rounded-lg border border-border p-3.5 bg-card/50 hover:border-primary/40 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium truncate">{p.name}</p>
                            <StatusBadge status={p.status} />
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1 font-mono" dir="ltr">{p.projectNumber}</p>
                          <div className="flex items-center gap-3 mt-2">
                            <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-cyan-500 to-sky-500" style={{ width: `${p.progress}%` }} />
                            </div>
                            <span className="text-[11px] text-muted-foreground shrink-0">{p.progress}%{p.deadline ? ` · due ${formatDate(p.deadline)}` : ""}</span>
                          </div>
                        </button>
                      ))
                    )}
                  </TabsContent>

                  {/* History */}
                  <TabsContent value="history" className="px-5 py-4 mt-0">
                    <ActivityTimeline items={data?.activities ?? []} emptyText="No history recorded for this client yet." />
                  </TabsContent>
                </ScrollArea>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Contact add/edit dialog */}
      {client && contactDialog && (
        <ContactFormDialog
          open
          onOpenChange={(o) => !o && setContactDialog(null)}
          clientId={client.id}
          contact={contactDialog.mode === "edit" ? contactDialog.contact : null}
          onSaved={() => { load(); onChanged(); }}
        />
      )}

      {/* Contact delete confirmation */}
      <AlertDialog open={contactDelete !== null} onOpenChange={(o) => !o && setContactDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this contact?</AlertDialogTitle>
            <AlertDialogDescription>“{contactDelete?.name}” will be permanently removed from this client.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deleteContact}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-xs text-muted-foreground shrink-0 pt-0.5 inline-flex items-center gap-1.5">{icon}{label}</span>
      <span className="text-sm text-right break-words min-w-0">{value}</span>
    </div>
  );
}

// ============ Contact form dialog ============

function ContactFormDialog({
  open, onOpenChange, clientId, contact, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  contact?: Contact | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredMethod, setPreferredMethod] = useState("EMAIL");
  const [isPrimary, setIsPrimary] = useState(false);
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(contact);

  useEffect(() => {
    if (open) {
      setName(contact?.name || "");
      setPosition(contact?.position || "");
      setEmail(contact?.email || "");
      setPhone(contact?.phone || "");
      setPreferredMethod(contact?.preferredMethod || "EMAIL");
      setIsPrimary(contact?.isPrimary || false);
      setNotes(contact?.notes || "");
      setFormError("");
    }
  }, [open, contact]);

  const submit = async () => {
    if (name.trim().length < 2) { setFormError("Contact name is required (min 2 characters)."); return; }
    setSaving(true);
    const payload = {
      name: name.trim(),
      position: position.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      preferredMethod,
      isPrimary,
      notes: notes.trim() || null,
    };
    try {
      if (isEdit && contact) {
        await api.patch(`/api/contacts/${contact.id}`, payload);
        toast({ title: "Contact updated", description: payload.name });
      } else {
        await api.post("/api/contacts", { ...payload, clientId });
        toast({ title: "Contact added", description: payload.name });
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({ title: isEdit ? "Update failed" : "Could not add contact", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>People who represent the client — the primary contact is used by default.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => { setName(e.target.value); setFormError(""); }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Position"><Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="CTO" /></Field>
            <Field label="Preferred method">
              <Select value={preferredMethod} onValueChange={setPreferredMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="PHONE">Phone</SelectItem>
                  <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" /></Field>
            <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" /></Field>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <Checkbox checked={isPrimary} onCheckedChange={(v) => setIsPrimary(v === true)} />
            <span className="text-sm">Primary contact</span>
          </label>
          <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
          {formError && <p className="text-xs text-destructive">{formError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEdit ? "Save changes" : "Add contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Client create/edit dialog ============

function ClientFormDialog({
  open, onOpenChange, client, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client?: ClientRow | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(client);

  useEffect(() => {
    if (open) {
      setCompanyName(client?.companyName || "");
      setIndustry(client?.industry || "");
      setLocation(client?.location || "");
      setWebsite(client?.website || "");
      setEmail(client?.email || "");
      setPhone(client?.phone || "");
      setNotes(client?.notes || "");
      setFormError("");
    }
  }, [open, client]);

  const submit = async () => {
    if (companyName.trim().length < 2) { setFormError("Company name is required (min 2 characters)."); return; }
    setSaving(true);
    const payload = {
      companyName: companyName.trim(),
      industry: industry.trim() || null,
      location: location.trim() || null,
      website: website.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      if (isEdit && client) {
        await api.patch(`/api/clients/${client.id}`, payload);
        toast({ title: "Client updated", description: payload.companyName });
      } else {
        const created = await api.post<{ clientNumber: string }>("/api/clients", payload);
        toast({ title: "Client created", description: `${created.clientNumber} — ${payload.companyName}` });
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({ title: isEdit ? "Update failed" : "Could not create client", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto apex-scroll">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit client" : "New client"}</DialogTitle>
          <DialogDescription>Company profile shared across projects, invoices and support.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Company name" required>
            <Input value={companyName} onChange={(e) => { setCompanyName(e.target.value); setFormError(""); }} placeholder="Acme Ltd." />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Industry"><Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Real estate" /></Field>
            <Field label="Location"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Cairo, Egypt" /></Field>
            <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" /></Field>
            <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" /></Field>
          </div>
          <Field label="Website"><Input value={website} onChange={(e) => setWebsite(e.target.value)} dir="ltr" /></Field>
          <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></Field>
          {formError && <p className="text-xs text-destructive">{formError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEdit ? "Save changes" : "Create client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Portal Access (§72) ============

function PortalAccessSection({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<PortalUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [pwTarget, setPwTarget] = useState<PortalUserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.get<{ users: PortalUserRow[] }>(`/api/clients/${clientId}/portal-users`);
      setUsers(d.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portal accounts.");
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const submitCreate = async () => {
    setFormError(null);
    if (form.name.trim().length < 2) { setFormError("Name is required."); return; }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { setFormError("A valid email is required."); return; }
    if (form.password.length < 8) { setFormError("Password must be at least 8 characters."); return; }
    setCreating(true);
    try {
      await api.post(`/api/clients/${clientId}/portal-users`, {
        name: form.name.trim(), email: form.email.trim().toLowerCase(), password: form.password,
      });
      toast({ title: "Portal access granted", description: `${form.email} can now sign in to the Client Portal.` });
      setCreateOpen(false);
      setForm({ name: "", email: "", password: "" });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create the portal account.");
    } finally {
      setCreating(false);
    }
  };

  const resetPassword = async () => {
    if (!pwTarget) return;
    if (newPassword.length < 8) { toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" }); return; }
    setPwBusy(true);
    try {
      await api.patch(`/api/portal-users/${pwTarget.id}`, { newPassword });
      toast({ title: "Password reset", description: `Share the new password securely with ${pwTarget.name}.` });
      setPwTarget(null);
      setNewPassword("");
    } catch (err) {
      toast({ title: "Reset failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
    } finally {
      setPwBusy(false);
    }
  };

  const toggleActive = async (u: PortalUserRow) => {
    setToggleBusyId(u.id);
    try {
      await api.patch(`/api/portal-users/${u.id}`, { isActive: !u.isActive });
      toast({ title: u.isActive ? "Portal access paused" : "Portal access restored", description: u.email });
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
    } finally {
      setToggleBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" /> Portal Access
          {users && users.length > 0 && <span className="text-[11px] text-muted-foreground">({users.length})</span>}
        </p>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Grant
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}
      {!error && users === null && (
        <div className="h-10 rounded-lg bg-secondary/30 animate-pulse" />
      )}
      {users && users.length === 0 && (
        <p className="text-xs text-muted-foreground border border-dashed border-border rounded-lg p-3.5 text-center">
          No portal accounts yet. Grant access so this client can track projects, invoices and tickets themselves.
        </p>
      )}
      {users && users.length > 0 && (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="rounded-lg border border-border p-3 bg-card/50 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[9px] font-bold shrink-0"
                    style={{ backgroundColor: `${u.avatarColor}22`, color: u.avatarColor }}
                  >
                    {u.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  <p className="text-sm font-medium truncate">{u.name}</p>
                  {!u.isActive && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">PAUSED</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate" dir="ltr">
                  {u.email} · {u.lastLoginAt ? `last sign-in ${formatDate(u.lastLoginAt)}` : "never signed in"}
                </p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Reset password for ${u.name}`} onClick={() => { setPwTarget(u); setNewPassword(""); }}>
                    <KeyRound className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className={u.isActive ? "h-7 w-7 text-rose-300" : "h-7 w-7 text-emerald-300"}
                    aria-label={u.isActive ? `Pause access for ${u.name}` : `Restore access for ${u.name}`}
                    disabled={toggleBusyId === u.id}
                    onClick={() => toggleActive(u)}
                  >
                    {toggleBusyId === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Grant access dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Grant portal access</DialogTitle>
            <DialogDescription>
              Creates a Client Portal account that can only see this company&apos;s projects, invoices and tickets.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 py-1">
            <Field label="Contact name" required>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Mona Hassan" />
            </Field>
            <Field label="Email" required hint="Used as the portal sign-in ID">
              <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} dir="ltr" placeholder="name@company.com" />
            </Field>
            <Field label="Temporary password" required hint="At least 8 characters — share it securely">
              <Input type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} dir="ltr" placeholder="********" autoComplete="off" />
            </Field>
            {formError && <p className="text-xs text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={submitCreate} disabled={creating}>
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={pwTarget !== null} onOpenChange={(o) => { if (!o) { setPwTarget(null); setNewPassword(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset portal password</DialogTitle>
            <DialogDescription>
              {pwTarget ? `Set a new password for ${pwTarget.name} (${pwTarget.email}).` : ""}
            </DialogDescription>
          </DialogHeader>
          <Field label="New password" required hint="At least 8 characters">
            <Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} dir="ltr" placeholder="********" autoComplete="off" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPwTarget(null); setNewPassword(""); }} disabled={pwBusy}>Cancel</Button>
            <Button onClick={resetPassword} disabled={pwBusy}>
              {pwBusy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
