import { useState, useRef, useCallback } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Topbar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
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
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Search,
  Package,
  ShieldAlert,
  Upload,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import * as XLSX from "xlsx";
import type { Product } from "@shared/schema";

interface ProductForm {
  itemCode: string;
  description: string;
  brand: string;
  department: string;
  sellingPrice: string;
  costPrice: string;
  category: string;
  salesMethod: string;
  availableQuantity: string;
  productCategoryId: string;
}

const EMPTY_FORM: ProductForm = {
  itemCode: "",
  description: "",
  brand: "",
  department: "",
  sellingPrice: "",
  costPrice: "",
  category: "",
  salesMethod: "",
  availableQuantity: "0",
  productCategoryId: "",
};

interface PaginatedProducts {
  data: Product[];
  total: number;
  page: number;
  totalPages: number;
}

export default function ProductsPage() {
  const { t } = useLang();
  usePageTitle(t.productsPage.title);
  const { token, user } = useAuth();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>({ ...EMPTY_FORM });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PAGE_SIZE = 50;

  const canManage = user?.role === "admin" || user?.role === "planning";

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 400);
  }, []);

  const { data: paginatedData, isLoading } = useQuery<PaginatedProducts>({
    queryKey: ["/api/products", { page, search: debouncedSearch }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/products?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
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

  const products = paginatedData?.data ?? [];
  const totalProducts = paginatedData?.total ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;

  const createMutation = useMutation({
    mutationFn: async (data: ProductForm) => {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemCode: data.itemCode,
          description: data.description,
          brand: data.brand,
          department: data.department,
          sellingPrice: data.sellingPrice,
          costPrice: data.costPrice,
          category: data.category,
          salesMethod: data.salesMethod,
          availableQuantity: parseInt(data.availableQuantity) || 0,
          productCategoryId: data.productCategoryId ? parseInt(data.productCategoryId) : null,
        }),
      });
      if (res.status === 409) throw new Error(t.productsPage.itemCodeExists);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: t.productsPage.productAdded });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: ProductForm }) => {
      const res = await fetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemCode: data.itemCode,
          description: data.description,
          brand: data.brand,
          department: data.department,
          sellingPrice: data.sellingPrice,
          costPrice: data.costPrice,
          category: data.category,
          salesMethod: data.salesMethod,
          availableQuantity: parseInt(data.availableQuantity) || 0,
          productCategoryId: data.productCategoryId ? parseInt(data.productCategoryId) : null,
        }),
      });
      if (res.status === 409) throw new Error(t.productsPage.itemCodeExists);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: t.productsPage.productUpdated });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/products/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: t.productsPage.productDeleted });
      setDeleteId(null);
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/products/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message);
      }
      return res.json();
    },
    onSuccess: (data: { created: number; updated: number; imported: number; skipped: number; total: number; errors: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      const parts: string[] = [];
      if (data.created > 0) {
        parts.push(t.productsPage.importCreated.replace("{count}", String(data.created)));
      }
      if (data.updated > 0) {
        parts.push(t.productsPage.importUpdated.replace("{count}", String(data.updated)));
      }
      if (data.skipped > 0) {
        parts.push(t.productsPage.importSkipped.replace("{skipped}", String(data.skipped)));
      }
      if (data.errors && data.errors.length > 0) {
        parts.push(data.errors.join(" | "));
      }
      toast({
        title: t.productsPage.importSuccess,
        description: parts.join(" | ") || `${data.imported} products`,
      });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      importMutation.mutate(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const downloadTemplate = () => {
    const headers = ["itemCode", "description", "brand", "sellingPrice", "costPrice", "category", "productCategory", "salesMethod", "availableQuantity"];
    const sample = ["SKU-001", "Sample Product", "Brand", "100.00", "80.00", "Category", "Product Category Name", "Method", "50"];
    const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "products_template.xlsx");
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingProduct(null);
    setForm({ ...EMPTY_FORM });
  };

  const openAdd = () => {
    setEditingProduct(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setForm({
      itemCode: p.itemCode,
      description: p.description,
      brand: p.brand,
      department: p.department,
      sellingPrice: p.sellingPrice,
      costPrice: p.costPrice,
      category: p.category,
      salesMethod: p.salesMethod || "",
      availableQuantity: String(p.availableQuantity),
      productCategoryId: p.productCategoryId ? String(p.productCategoryId) : "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!form.itemCode || !form.description || !form.brand || !form.department || !form.sellingPrice || !form.costPrice || !form.category) {
      toast({ title: t.common.error, description: "All fields are required", variant: "destructive" });
      return;
    }
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const startItem = (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, totalProducts);

  if (!canManage) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={t.productsPage.title} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <ShieldAlert className="w-12 h-12 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">{t.productsPage.accessDenied}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t.productsPage.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground rtl:left-auto rtl:right-3" />
              <Input
                placeholder={t.productsPage.search}
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9 rtl:pl-3 rtl:pr-9"
                data-testid="input-product-search"
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
              data-testid="input-upload-excel"
            />
            <Button variant="outline" onClick={downloadTemplate} className="gap-2" data-testid="button-download-template">
              <Download className="w-4 h-4 shrink-0" />
              <span>{t.productsPage.downloadTemplate}</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importMutation.isPending}
              className="gap-2"
              data-testid="button-upload-excel"
            >
              {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Upload className="w-4 h-4 shrink-0" />}
              <span>{importMutation.isPending ? t.productsPage.uploading : t.productsPage.uploadExcel}</span>
            </Button>
            <Button onClick={openAdd} className="gap-2" data-testid="button-add-product">
              <Plus className="w-4 h-4 shrink-0" />
              <span>{t.productsPage.addProduct}</span>
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p>{t.productsPage.noProducts}</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-products">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-start p-3 font-medium">{t.productsPage.itemCode}</th>
                      <th className="text-start p-3 font-medium">{t.productsPage.description}</th>
                      <th className="text-start p-3 font-medium">{t.productsPage.brand}</th>
                      <th className="text-start p-3 font-medium">{t.productsPage.sellingPrice}</th>
                      <th className="text-start p-3 font-medium">{t.productsPage.costPrice}</th>
                      <th className="text-start p-3 font-medium">{t.productsPage.category}</th>
                      <th className="text-start p-3 font-medium">{t.requestCreate.productCategory}</th>
                      <th className="text-start p-3 font-medium">{t.productsPage.salesMethod}</th>
                      <th className="text-start p-3 font-medium">{t.productsPage.availableQuantity}</th>
                      <th className="p-3 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id} className="border-b hover-elevate" data-testid={`row-product-${p.id}`}>
                        <td className="p-3 font-mono text-xs">
                          <Badge variant="outline">{p.itemCode}</Badge>
                        </td>
                        <td className="p-3">{p.description}</td>
                        <td className="p-3">{p.brand}</td>
                        <td className="p-3 font-mono">{parseFloat(p.sellingPrice).toLocaleString()}</td>
                        <td className="p-3 font-mono">{parseFloat(p.costPrice).toLocaleString()}</td>
                        <td className="p-3">
                          <Badge variant="outline">{p.category}</Badge>
                        </td>
                        <td className="p-3">
                          {p.productCategoryId ? (
                            <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800">
                              {productCategories?.find(c => c.id === p.productCategoryId)?.name || "-"}
                            </Badge>
                          ) : "-"}
                        </td>
                        <td className="p-3">{p.salesMethod}</td>
                        <td className="p-3 font-mono">{p.availableQuantity}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(p)}
                              data-testid={`button-edit-product-${p.id}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteId(p.id)}
                              data-testid={`button-delete-product-${p.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2" data-testid="pagination-products">
                  <p className="text-sm text-muted-foreground">
                    {t.productsPage.showing
                      .replace("{start}", String(startItem))
                      .replace("{end}", String(endItem))
                      .replace("{total}", String(totalProducts))}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page <= 1}
                      onClick={() => setPage(1)}
                      data-testid="button-first-page"
                    >
                      <ChevronsLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="px-3 text-sm font-medium">
                      {t.productsPage.pageOf
                        .replace("{page}", String(page))
                        .replace("{total}", String(totalPages))}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page >= totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      data-testid="button-next-page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page >= totalPages}
                      onClick={() => setPage(totalPages)}
                      data-testid="button-last-page"
                    >
                      <ChevronsRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? t.productsPage.editProduct : t.productsPage.addProduct}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.productsPage.itemCode} <span className="text-destructive">*</span></Label>
                <Input
                  value={form.itemCode}
                  onChange={(e) => setForm({ ...form, itemCode: e.target.value })}
                  data-testid="input-product-item-code"
                />
              </div>
              <div className="space-y-1">
                <Label>{t.productsPage.department} <span className="text-destructive">*</span></Label>
                <Input
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  data-testid="input-product-department"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t.productsPage.description} <span className="text-destructive">*</span></Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                data-testid="input-product-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.productsPage.brand} <span className="text-destructive">*</span></Label>
                <Input
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  data-testid="input-product-brand"
                />
              </div>
              <div className="space-y-1">
                <Label>{t.productsPage.category} <span className="text-destructive">*</span></Label>
                <Input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  data-testid="input-product-category"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.requestCreate.productCategory}</Label>
                <Select
                  value={form.productCategoryId}
                  onValueChange={(v) => setForm({ ...form, productCategoryId: v === "none" ? "" : v })}
                >
                  <SelectTrigger data-testid="select-product-category">
                    <SelectValue placeholder={t.requestCreate.selectProductCategory} />
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
              <div className="space-y-1">
                <Label>{t.productsPage.salesMethod}</Label>
                <Input
                  value={form.salesMethod}
                  onChange={(e) => setForm({ ...form, salesMethod: e.target.value })}
                  data-testid="input-product-sales-method"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>{t.productsPage.sellingPrice} <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.sellingPrice}
                  onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                  data-testid="input-product-selling-price"
                />
              </div>
              <div className="space-y-1">
                <Label>{t.productsPage.costPrice} <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                  data-testid="input-product-cost-price"
                />
              </div>
              <div className="space-y-1">
                <Label>{t.productsPage.availableQuantity}</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.availableQuantity}
                  onChange={(e) => setForm({ ...form, availableQuantity: e.target.value })}
                  data-testid="input-product-available-qty"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-product">
              {t.productsPage.cancel}
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving} data-testid="button-save-product">
              {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
              {t.productsPage.save}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.productsPage.deleteProduct}</AlertDialogTitle>
            <AlertDialogDescription>{t.productsPage.deleteConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">{t.productsPage.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              data-testid="button-confirm-delete"
            >
              {t.productsPage.deleteProduct}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
