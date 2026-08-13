import { useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { getRoleLabels } from "@/lib/role-utils";
import { Users, Plus, Pencil, Trash2, Loader2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { User, Branch, UserRole } from "@shared/schema";
import { userRoles } from "@shared/schema";
import { useLang } from "@/lib/i18n";

type UserWithBranch = User & { branch?: Branch; branchIds?: number[] };

export default function UsersPage() {
  usePageTitle("المستخدمون");
  const { token, user: currentUser } = useAuth();
  const { toast } = useToast();
  const { t } = useLang();
  const roleLabels = getRoleLabels(t);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithBranch | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "sales_rep" as UserRole,
    branchId: "" as string,
    branchIds: [] as number[],
    productCategoryId: "" as string,
  });

  const { data: users, isLoading: usersLoading } = useQuery<UserWithBranch[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await fetch("/api/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ["/api/branches"],
    queryFn: async () => {
      const res = await fetch("/api/branches", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load branches");
      return res.json();
    },
  });

  const { data: productCategories } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/product-categories"],
    queryFn: async () => {
      const res = await fetch("/api/product-categories", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const url = editingUser ? `/api/users/${editingUser.id}` : "/api/users";
      const method = editingUser ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to save user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: editingUser ? t.users.userUpdated : t.users.userCreated });
    },
    onError: (error: Error) => {
      toast({ title: t.common.error, description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to delete user");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: t.users.userDeleted });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      email: "",
      password: "",
      role: "sales_rep",
      branchId: "",
      branchIds: [],
      productCategoryId: "",
    });
    setEditingUser(null);
  };

  const handleEdit = (user: UserWithBranch) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role as UserRole,
      branchId: user.branchId ? String(user.branchId) : "",
      branchIds: user.branchIds || (user.branchId ? [user.branchId] : []),
      productCategoryId: (user as any).productCategoryId ? String((user as any).productCategoryId) : "",
    });
    setIsDialogOpen(true);
  };

  const toggleBranchId = (branchId: number) => {
    setFormData(prev => ({
      ...prev,
      branchIds: prev.branchIds.includes(branchId)
        ? prev.branchIds.filter(id => id !== branchId)
        : [...prev.branchIds, branchId],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: any = { ...formData };
    if (editingUser && !data.password) delete data.password;
    if (data.role === "branch_manager") {
      data.branchId = data.branchIds.length > 0 ? data.branchIds[0] : null;
      data.branchIds = data.branchIds;
    } else {
      if (data.branchId === "") {
        data.branchId = null;
      } else {
        data.branchId = parseInt(data.branchId);
      }
      delete data.branchIds;
    }
    if (data.role === "category_manager" && data.productCategoryId && data.productCategoryId !== "none") {
      data.productCategoryId = parseInt(data.productCategoryId);
    } else {
      data.productCategoryId = null;
    }
    mutation.mutate(data);
  };

  const isAdmin = currentUser?.role === "admin";

  const filteredUsers = users?.filter(u => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t.users.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t.users.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ps-9"
              data-testid="input-search-users"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full sm:w-48" data-testid="select-role-filter">
              <SelectValue placeholder={t.users.filterByRole} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.users.allRoles}</SelectItem>
              {userRoles.map((role) => (
                <SelectItem key={role} value={role}>
                  {roleLabels[role as keyof typeof roleLabels]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdmin && (
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-user" className="shrink-0">
                  <Plus className="w-4 h-4" />
                  <span>{t.users.addUser}</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingUser ? t.users.editUser : t.users.addNewUser}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">{t.users.fullName}</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">{t.auth.email}</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">
                      {t.auth.password} {editingUser && `(${t.auth.leaveEmpty})`}
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      required={!editingUser}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t.users.role}</Label>
                    <Select
                      value={formData.role}
                      onValueChange={(v) => setFormData({ ...formData, role: v as UserRole })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t.users.selectRole} />
                      </SelectTrigger>
                      <SelectContent>
                        {userRoles.map((role) => (
                          <SelectItem key={role} value={role}>
                            {roleLabels[role as keyof typeof roleLabels]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {formData.role === "branch_manager" ? (
                    <div className="space-y-2">
                      <Label>{t.users.branches}</Label>
                      <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto">
                        {branches?.map((b) => (
                          <label key={b.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 px-2 py-1 rounded">
                            <input
                              type="checkbox"
                              checked={formData.branchIds.includes(b.id)}
                              onChange={() => toggleBranchId(b.id)}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm">{b.name}</span>
                          </label>
                        ))}
                        {(!branches || branches.length === 0) && (
                          <p className="text-sm text-muted-foreground">{t.users.none}</p>
                        )}
                      </div>
                      {formData.branchIds.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {formData.branchIds.map(bid => {
                            const br = branches?.find(b => b.id === bid);
                            return br ? (
                              <Badge key={bid} variant="secondary" className="text-xs">
                                {br.name}
                              </Badge>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>{t.users.branch}</Label>
                      <Select
                        value={formData.branchId}
                        onValueChange={(v) => setFormData({ ...formData, branchId: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t.users.selectBranch} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t.users.none}</SelectItem>
                          {branches?.map((b) => (
                            <SelectItem key={b.id} value={String(b.id)}>
                              {b.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {formData.role === "category_manager" && (
                    <div className="space-y-2">
                      <Label>{t.users.productCategory}</Label>
                      <Select
                        value={formData.productCategoryId}
                        onValueChange={(v) => setFormData({ ...formData, productCategoryId: v })}
                      >
                        <SelectTrigger data-testid="select-user-product-category">
                          <SelectValue placeholder={t.users.selectProductCategory} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t.users.none}</SelectItem>
                          {productCategories?.map((cat) => (
                            <SelectItem key={cat.id} value={String(cat.id)}>
                              {cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <DialogFooter>
                    <Button type="submit" disabled={mutation.isPending}>
                      {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>{editingUser ? t.users.updateUser : t.users.createUser}</span>
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {usersLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-4 w-48" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !filteredUsers || filteredUsers.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-base font-medium text-muted-foreground">{t.users.noUsers}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredUsers.map((u) => {
              const initials = u.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
              return (
                <Card key={u.id} data-testid={`user-card-${u.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Avatar className="w-10 h-10 flex-shrink-0">
                          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium">{u.name}</p>
                            <Badge variant="secondary" className="text-[10px]">
                              {roleLabels[u.role as keyof typeof roleLabels]}
                            </Badge>
                            {u.role === "branch_manager" && u.branchIds && u.branchIds.length > 0 ? (
                              u.branchIds.map(bid => {
                                const br = branches?.find(b => b.id === bid);
                                return br ? (
                                  <Badge key={bid} variant="outline" className="text-[10px]">
                                    {br.name}
                                  </Badge>
                                ) : null;
                              })
                            ) : u.branch ? (
                              <Badge variant="outline" className="text-[10px]">
                                {u.branch.name}
                              </Badge>
                            ) : null}
                            {u.role === "category_manager" && (u as any).productCategoryId && (() => {
                              const cat = productCategories?.find(c => c.id === (u as any).productCategoryId);
                              return cat ? (
                                <Badge variant="outline" className="text-[10px] bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800">
                                  {cat.name}
                                </Badge>
                              ) : null;
                            })()}
                          </div>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                      {isAdmin && u.id !== currentUser?.id && (
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(u)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => {
                            if (confirm(t.users.confirmDelete)) {
                              deleteMutation.mutate(u.id);
                            }
                          }}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
