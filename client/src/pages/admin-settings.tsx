import { useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Trash2,
  Loader2,
  Building2,
  Warehouse,
  MapPin,
  Pencil,
  Check,
  X,
  Tag,
} from "lucide-react";
import { useLang } from "@/lib/i18n";

interface AdminItem {
  id: number;
  name: string;
  createdAt: string;
}

interface WarehouseItem extends AdminItem {
  location: string | null;
}

interface SectionTranslations {
  plural: string;
  singular: string;
  addPlaceholder: string;
  emptyMsg: string;
  addLabel: string;
  addedMsg: string;
  deletedMsg: string;
}

function SettingsSection({
  title,
  icon: Icon,
  queryKey,
  apiPath,
  token,
  translations,
}: {
  title: string;
  icon: any;
  queryKey: string;
  apiPath: string;
  token: string;
  translations: SectionTranslations;
}) {
  const { toast } = useToast();
  const { t } = useLang();
  const [newName, setNewName] = useState("");

  const { data: items, isLoading } = useQuery<AdminItem[]>({
    queryKey: [queryKey],
    queryFn: async () => {
      const res = await fetch(apiPath, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to add");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      setNewName("");
      toast({ title: translations.addedMsg });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${apiPath}/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast({ title: translations.deletedMsg });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    addMutation.mutate(newName.trim());
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{translations.plural}</h3>
          <Badge variant="secondary" className="text-xs">
            {items?.length ?? 0}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleAdd} className="flex items-center gap-2">
          <Input
            placeholder={translations.addPlaceholder}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            data-testid={`input-new-${title.toLowerCase()}`}
          />
          <Button
            type="submit"
            size="sm"
            disabled={addMutation.isPending || !newName.trim()}
            data-testid={`button-add-${title.toLowerCase()}`}
          >
            {addMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Plus className="w-3 h-3" />
            )}
            <span>{translations.addLabel}</span>
          </Button>
        </form>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items && items.length > 0 ? (
          <div className="space-y-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 py-2 px-3 border rounded-md"
                data-testid={`item-${title.toLowerCase()}-${item.id}`}
              >
                <span className="text-sm font-medium">{item.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMutation.mutate(item.id)}
                  disabled={deleteMutation.isPending}
                  data-testid={`button-delete-${title.toLowerCase()}-${item.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            {translations.emptyMsg}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface DepartmentItem extends AdminItem {
  branchId: number | null;
  branchIds: number[];
}

function DepartmentSection({ token }: { token: string }) {
  const { toast } = useToast();
  const { t } = useLang();
  const [newName, setNewName] = useState("");
  const [newBranchIds, setNewBranchIds] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBranchIds, setEditBranchIds] = useState<number[]>([]);

  const { data: items, isLoading } = useQuery<DepartmentItem[]>({
    queryKey: ["/api/admin/departments"],
    queryFn: async () => {
      const res = await fetch("/api/admin/departments", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: branchesList } = useQuery<AdminItem[]>({
    queryKey: ["/api/branches"],
    queryFn: async () => {
      const res = await fetch("/api/branches", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async ({ name, branchIds }: { name: string; branchIds: number[] }) => {
      const res = await fetch("/api/admin/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, branchIds }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to add");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/departments"] });
      setNewName("");
      setNewBranchIds([]);
      toast({ title: t.adminSettings.departmentAdded });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, branchIds }: { id: number; branchIds: number[] }) => {
      const res = await fetch(`/api/admin/departments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ branchIds }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/departments"] });
      setEditingId(null);
      toast({ title: t.adminSettings.departmentUpdated });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/departments/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/departments"] });
      toast({ title: t.adminSettings.departmentDeleted });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    addMutation.mutate({ name: newName.trim(), branchIds: newBranchIds });
  };

  const startEdit = (item: DepartmentItem) => {
    setEditingId(item.id);
    setEditBranchIds(item.branchIds || []);
  };

  const toggleNewBranch = (branchId: number) => {
    setNewBranchIds(prev =>
      prev.includes(branchId) ? prev.filter(id => id !== branchId) : [...prev, branchId]
    );
  };

  const toggleEditBranch = (branchId: number) => {
    setEditBranchIds(prev =>
      prev.includes(branchId) ? prev.filter(id => id !== branchId) : [...prev, branchId]
    );
  };

  const getBranchNames = (branchIds: number[]) => {
    if (!branchIds || branchIds.length === 0) return t.adminSettings.noBranch;
    return branchIds
      .map(id => branchesList?.find(b => b.id === id)?.name || "—")
      .join(", ");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t.adminSettings.departments}</h3>
          <Badge variant="secondary" className="text-xs">
            {items?.length ?? 0}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleAdd} className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              placeholder={t.adminSettings.addDepartment}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              data-testid="input-new-department-name"
            />
            <Button
              type="submit"
              size="sm"
              disabled={addMutation.isPending || !newName.trim()}
              data-testid="button-add-department"
            >
              {addMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              <span>{t.adminSettings.add}</span>
            </Button>
          </div>
          {branchesList && branchesList.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {branchesList.map((b) => (
                <Badge
                  key={b.id}
                  variant={newBranchIds.includes(b.id) ? "default" : "outline"}
                  className="cursor-pointer toggle-elevate"
                  onClick={() => toggleNewBranch(b.id)}
                  data-testid={`badge-new-branch-${b.id}`}
                >
                  <MapPin className="w-3 h-3" />
                  {b.name}
                </Badge>
              ))}
            </div>
          )}
        </form>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items && items.length > 0 ? (
          <div className="space-y-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 py-2 px-3 border rounded-md"
                data-testid={`item-department-${item.id}`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{item.name}</span>
                  {editingId === item.id ? (
                    <div className="mt-1.5 space-y-1.5">
                      <div className="flex flex-wrap gap-1.5">
                        {branchesList?.map((b) => (
                          <Badge
                            key={b.id}
                            variant={editBranchIds.includes(b.id) ? "default" : "outline"}
                            className="cursor-pointer toggle-elevate"
                            onClick={() => toggleEditBranch(b.id)}
                            data-testid={`badge-edit-branch-${item.id}-${b.id}`}
                          >
                            <MapPin className="w-3 h-3" />
                            {b.name}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => updateMutation.mutate({ id: item.id, branchIds: editBranchIds })}
                          disabled={updateMutation.isPending}
                          data-testid={`button-save-branch-${item.id}`}
                        >
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingId(null)}
                          data-testid={`button-cancel-branch-${item.id}`}
                        >
                          <X className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        {getBranchNames(item.branchIds)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => startEdit(item)}
                        data-testid={`button-edit-branch-${item.id}`}
                      >
                        <Pencil className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMutation.mutate(item.id)}
                  disabled={deleteMutation.isPending}
                  data-testid={`button-delete-department-${item.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t.adminSettings.noDepartments}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function WarehouseSection({ token }: { token: string }) {
  const { toast } = useToast();
  const { t } = useLang();
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLocation, setEditLocation] = useState("");

  const { data: items, isLoading } = useQuery<WarehouseItem[]>({
    queryKey: ["/api/admin/warehouses"],
    queryFn: async () => {
      const res = await fetch("/api/admin/warehouses", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async ({ name, location }: { name: string; location: string }) => {
      const res = await fetch("/api/admin/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, location }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to add");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouses"] });
      setNewName("");
      setNewLocation("");
      toast({ title: t.adminSettings.warehouseAdded });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, location }: { id: number; location: string }) => {
      const res = await fetch(`/api/admin/warehouses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ location }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouses"] });
      setEditingId(null);
      toast({ title: t.adminSettings.warehouseUpdated });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/warehouses/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouses"] });
      toast({ title: t.adminSettings.warehouseDeleted });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    addMutation.mutate({ name: newName.trim(), location: newLocation.trim() });
  };

  const startEdit = (item: WarehouseItem) => {
    setEditingId(item.id);
    setEditLocation(item.location || "");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Warehouse className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t.adminSettings.warehouses}</h3>
          <Badge variant="secondary" className="text-xs">
            {items?.length ?? 0}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleAdd} className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              placeholder={t.adminSettings.addWarehouse}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              data-testid="input-new-warehouse-name"
            />
            <Input
              placeholder={t.adminSettings.warehouseLocationPlaceholder}
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              data-testid="input-new-warehouse-location"
            />
            <Button
              type="submit"
              size="sm"
              disabled={addMutation.isPending || !newName.trim()}
              data-testid="button-add-warehouse"
            >
              {addMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              <span>{t.adminSettings.add}</span>
            </Button>
          </div>
        </form>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items && items.length > 0 ? (
          <div className="space-y-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 py-2 px-3 border rounded-md"
                data-testid={`item-warehouse-${item.id}`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{item.name}</span>
                  {editingId === item.id ? (
                    <div className="flex items-center gap-1 mt-1">
                      <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                      <Input
                        value={editLocation}
                        onChange={(e) => setEditLocation(e.target.value)}
                        placeholder={t.adminSettings.warehouseLocationPlaceholder}
                        className="h-7 text-xs"
                        data-testid={`input-edit-location-${item.id}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => updateMutation.mutate({ id: item.id, location: editLocation })}
                        disabled={updateMutation.isPending}
                        data-testid={`button-save-location-${item.id}`}
                      >
                        <Check className="w-3.5 h-3.5 text-green-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingId(null)}
                        data-testid={`button-cancel-location-${item.id}`}
                      >
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-xs text-muted-foreground truncate">
                        {item.location || "—"}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => startEdit(item)}
                        data-testid={`button-edit-location-${item.id}`}
                      >
                        <Pencil className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMutation.mutate(item.id)}
                  disabled={deleteMutation.isPending}
                  data-testid={`button-delete-warehouse-${item.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t.adminSettings.noWarehouses}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminSettingsPage() {
  usePageTitle("الإعدادات");
  const { token, user } = useAuth();
  const { t } = useLang();

  if (user?.role !== "admin") {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={t.adminSettings.title} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">{t.adminSettings.adminRequired}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t.adminSettings.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <DepartmentSection token={token!} />
          <WarehouseSection token={token!} />
          <SettingsSection
            title={t.adminSettings.branches}
            icon={Building2}
            queryKey="/api/branches"
            apiPath="/api/branches"
            token={token!}
            translations={{
              plural: t.adminSettings.branches,
              singular: t.adminSettings.branches,
              addPlaceholder: t.adminSettings.addBranch,
              emptyMsg: t.adminSettings.noBranches,
              addLabel: t.adminSettings.add,
              addedMsg: t.adminSettings.branchAdded,
              deletedMsg: t.adminSettings.branchDeleted,
            }}
          />
          <SettingsSection
            title={t.adminSettings.productCategories}
            icon={Tag}
            queryKey="/api/product-categories"
            apiPath="/api/product-categories"
            token={token!}
            translations={{
              plural: t.adminSettings.productCategories,
              singular: t.adminSettings.productCategories,
              addPlaceholder: t.adminSettings.addProductCategory,
              emptyMsg: t.adminSettings.noProductCategories,
              addLabel: t.adminSettings.add,
              addedMsg: t.adminSettings.productCategoryAdded,
              deletedMsg: t.adminSettings.productCategoryDeleted,
            }}
          />
        </div>
      </div>
    </div>
  );
}
