import { useState, useCallback, useRef, useEffect } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  Plus,
  Trash2,
  Loader2,
  Send,
  Upload,
  FileSpreadsheet,
  Calendar,
  AlertCircle,
  Info,
  Download,
} from "lucide-react";
import { reservationDurationOptions } from "@shared/schema";
import { useLang } from "@/lib/i18n";

interface ItemRow {
  itemCode: string;
  itemDescription: string;
  brand: string;
  quantityRequested: number;
  warehouse: string;
  sellingPrice?: string;
  costPrice?: string;
  lookupStatus?: "idle" | "loading" | "found" | "not_found" | "category_mismatch";
}

const EMPTY_ITEM: ItemRow = {
  itemCode: "",
  itemDescription: "",
  brand: "",
  quantityRequested: 1,
  warehouse: "",
  sellingPrice: "",
  costPrice: "",
  lookupStatus: "idle",
};

function calculateEndDate(requestDate: string, durationDays: string): string {
  if (!requestDate || !durationDays) return "";
  const d = new Date(requestDate);
  d.setDate(d.getDate() + parseInt(durationDays, 10));
  return d.toISOString().split("T")[0];
}

export default function RequestCreatePage() {
  usePageTitle("طلب جديد");
  const { token, user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t, isRTL } = useLang();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const poFileInputRef = useRef<HTMLInputElement>(null);
  const asFileInputRef = useRef<HTMLInputElement>(null);

  const today = new Date().toISOString().split("T")[0];

  const [department, setDepartment] = useState("");
  const [productCategoryId, setProductCategoryId] = useState("");
  const [salesChannel, setSalesChannel] = useState(user?.role === "planning" ? "strategic_reservation" : "");
  const [customerName, setCustomerName] = useState("");
  const [customerAccountNumber, setCustomerAccountNumber] = useState("");
  const [projectName, setProjectName] = useState("");
  const [salesRepId, setSalesRepId] = useState("");
  const [reservationDuration, setReservationDuration] = useState("");
  const [reservationEndDate, setReservationEndDate] = useState("");
  const [advancePayment, setAdvancePayment] = useState("");
  const [notes, setNotes] = useState("");
  const [purchaseOrderFile, setPurchaseOrderFile] = useState<string>("");
  const [poFileName, setPoFileName] = useState("");
  const [uploadingPO, setUploadingPO] = useState(false);
  const [accountStatementFile, setAccountStatementFile] = useState<string>("");
  const [asFileName, setAsFileName] = useState("");
  const [uploadingAS, setUploadingAS] = useState(false);

  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [useExcel, setUseExcel] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (reservationDuration) {
      setReservationEndDate(calculateEndDate(today, reservationDuration));
    } else {
      setReservationEndDate("");
    }
  }, [reservationDuration, today]);

  const { data: departments } = useQuery<{ id: number; name: string; branchId: number | null }[]>({
    queryKey: ["/api/admin/departments"],
    queryFn: async () => {
      const res = await fetch("/api/admin/departments", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: warehouses } = useQuery<{ id: number; name: string; location: string | null }[]>({
    queryKey: ["/api/admin/warehouses"],
    queryFn: async () => {
      const res = await fetch("/api/admin/warehouses", {
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

  const selectedDepartment = departments?.find(d => d.name === department);
  const selectedDeptId = selectedDepartment?.id;

  const { data: salesReps } = useQuery<{ id: number; name: string; email: string; branchId: number | null }[]>({
    queryKey: ["/api/admin/sales-reps", selectedDeptId],
    queryFn: async () => {
      const url = selectedDeptId
        ? `/api/admin/sales-reps?departmentId=${selectedDeptId}`
        : "/api/admin/sales-reps";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const filteredSalesReps = salesReps;

  const durationNum = reservationDuration ? parseInt(reservationDuration, 10) : 0;
  const requiresPaymentAndPO = durationNum > 15;

  const addItem = () => {
    setItems([...items, { ...EMPTY_ITEM }]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (
    index: number,
    field: keyof ItemRow,
    value: string | number
  ) => {
    const updated = [...items];
    if (field === "quantityRequested") {
      updated[index][field] = Math.max(0, Number(value));
    } else {
      (updated[index] as any)[field] = value;
    }
    setItems(updated);
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingExcel(true);
    try {
      const formData = new FormData();
      formData.append("excel", file);

      const res = await fetch("/api/upload/excel", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || t.requestCreate.excelImportFailed);
      }

      const parsedItems: ItemRow[] = data.items.map((item: any) => ({
        itemCode: item.itemCode || "",
        itemDescription: item.itemDescription || "",
        brand: item.brand || "",
        quantityRequested: item.quantityRequested || 1,
        warehouse: item.warehouse || "",
        sellingPrice: item.sellingPrice || "",
        costPrice: item.costPrice || "",
        lookupStatus: item.lookupStatus || "found" as const,
      }));

      setItems(parsedItems.length > 0 ? parsedItems : [{ ...EMPTY_ITEM }]);
      toast({
        title: t.requestCreate.excelImported,
        description: `${parsedItems.length} ${t.requestCreate.productsLoaded}`,
      });
      if (data.notFoundCodes && data.notFoundCodes.length > 0) {
        toast({
          title: t.productsPage.itemNotFound,
          description: `${data.notFoundCodes.join("، ")} — ${t.productsPage.contactPlanning}`,
          variant: "destructive",
          duration: 10000,
        });
      }
    } catch (err: any) {
      toast({
        title: t.requestCreate.excelImportFailed,
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setUploadingExcel(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePOUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPO(true);
    try {
      const formData = new FormData();
      formData.append("purchaseOrder", file);

      const res = await fetch("/api/upload/purchase-order", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || t.requestCreate.uploadFailed);
      }

      setPurchaseOrderFile(data.filePath);
      setPoFileName(file.name);
      toast({ title: t.requestCreate.fileUploaded, description: file.name });
    } catch (err: any) {
      toast({
        title: t.requestCreate.uploadFailed,
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setUploadingPO(false);
      if (poFileInputRef.current) poFileInputRef.current.value = "";
    }
  };

  const handleASUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAS(true);
    try {
      const formData = new FormData();
      formData.append("accountStatement", file);

      const res = await fetch("/api/upload/account-statement", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || t.requestCreate.uploadFailed);
      }

      setAccountStatementFile(data.filePath);
      setAsFileName(file.name);
      toast({ title: t.requestCreate.fileUploaded, description: file.name });
    } catch (err: any) {
      toast({
        title: t.requestCreate.uploadFailed,
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setUploadingAS(false);
      if (asFileInputRef.current) asFileInputRef.current.value = "";
    }
  };

  const lookupTimers = useRef<Record<number, NodeJS.Timeout>>({});

  const lookupProduct = useCallback((index: number, code: string) => {
    if (lookupTimers.current[index]) {
      clearTimeout(lookupTimers.current[index]);
    }

    if (!code.trim()) {
      setItems(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], itemDescription: "", brand: "", sellingPrice: "", costPrice: "", lookupStatus: "idle" };
        return updated;
      });
      return;
    }

    setItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], lookupStatus: "loading" };
      return updated;
    });

    lookupTimers.current[index] = setTimeout(async () => {
      try {
        let url = `/api/products/lookup/${encodeURIComponent(code.trim())}`;
        if (productCategoryId) {
          url += `?productCategoryId=${productCategoryId}`;
        }
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 404) {
          const errorData = await res.json().catch(() => ({}));
          setItems(prev => {
            const updated = [...prev];
            updated[index] = {
              ...updated[index],
              itemDescription: "",
              brand: "",
              sellingPrice: "",
              costPrice: "",
              lookupStatus: errorData.categoryMismatch ? "category_mismatch" : "not_found",
            };
            return updated;
          });
          return;
        }
        if (!res.ok) throw new Error("Lookup failed");
        const product = await res.json();
        setItems(prev => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            itemDescription: product.description,
            brand: product.brand,
            sellingPrice: product.sellingPrice,
            costPrice: product.costPrice,
            lookupStatus: "found",
          };
          return updated;
        });
      } catch {
        setItems(prev => {
          const updated = [...prev];
          updated[index] = { ...updated[index], lookupStatus: "idle" };
          return updated;
        });
      }
    }, 500);
  }, [token, productCategoryId]);

  useEffect(() => {
    items.forEach((item, index) => {
      if (item.itemCode.trim() && (item.lookupStatus === "found" || item.lookupStatus === "not_found" || item.lookupStatus === "category_mismatch")) {
        lookupProduct(index, item.itemCode);
      }
    });
  }, [productCategoryId]);

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!department) errors.push(t.requestCreate.departmentRequired);
    if (!productCategoryId) errors.push(t.requestCreate.productCategoryRequired);
    if (!customerName.trim()) errors.push(t.requestCreate.customerNameRequired);
    if (!customerAccountNumber.trim()) errors.push(t.requestCreate.customerAccountNumberRequired);
    if (!projectName.trim()) errors.push(t.requestCreate.projectNameRequired);
    const isStrategicChannel = salesChannel === "strategic_reservation" && user?.role === "planning";
    if (!isStrategicChannel && !salesRepId) errors.push(t.requestCreate.salesRepRequired);
    if (!reservationDuration) errors.push(t.requestCreate.durationRequired);

    if (requiresPaymentAndPO) {
      const hasPaymentPath = !!advancePayment && !!accountStatementFile;
      const hasPOPath = !!purchaseOrderFile;
      if (!hasPaymentPath && !hasPOPath) {
        errors.push(t.requestCreate.advancePaymentOrPORequired);
      }
    }

    if (items.length === 0) {
      errors.push(t.requestCreate.atLeastOneProduct);
    }

    items.forEach((item, i) => {
      const row = i + 1;
      if (!item.itemCode.trim()) errors.push(`${t.requestCreate.product} ${row}: ${t.requestCreate.itemCodeRequired}`);
      else if (item.lookupStatus !== "found") errors.push(`${t.requestCreate.product} ${row}: ${t.requestCreate.itemMustExist}`);
      if (!item.itemDescription.trim())
        errors.push(`${t.requestCreate.product} ${row}: ${t.requestCreate.itemDescRequired}`);
      if (!item.brand.trim()) errors.push(`${t.requestCreate.product} ${row}: ${t.requestCreate.brandRequired}`);
      if (!item.quantityRequested || item.quantityRequested <= 0)
        errors.push(`${t.requestCreate.product} ${row}: ${t.requestCreate.qtyMustBePositive}`);
      if (!item.warehouse) errors.push(`${t.requestCreate.product} ${row}: ${t.requestCreate.warehouseRequired}`);
    });

    return errors;
  };

  const isFormValid = (): boolean => {
    return validateForm().length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    const errors = validateForm();
    if (errors.length > 0) {
      toast({
        title: t.requestCreate.validationErrors,
        description: errors.slice(0, 3).join(". ") + (errors.length > 3 ? ` (+${errors.length - 3} ${t.requestCreate.others})` : ""),
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const isStrategicSubmit = salesChannel === "strategic_reservation" && user?.role === "planning";
      const payload = {
        department,
        customerName,
        customerAccountNumber,
        projectName,
        salesRepId: isStrategicSubmit ? user.id : parseInt(salesRepId, 10),
        productCategoryId: parseInt(productCategoryId, 10),
        reservationDuration,
        reservationEndDate,
        advancePayment: advancePayment ? parseFloat(advancePayment) : undefined,
        purchaseOrderFile: purchaseOrderFile || undefined,
        accountStatementFile: accountStatementFile || undefined,
        salesChannel: salesChannel || undefined,
        notes: notes || undefined,
        items: items.map((item) => ({
          itemCode: item.itemCode,
          itemDescription: item.itemDescription,
          brand: item.brand,
          quantityRequested: item.quantityRequested,
          warehouse: item.warehouse,
          sellingPrice: item.sellingPrice || undefined,
          costPrice: item.costPrice || undefined,
        })),
      };

      const res = await fetch("/api/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || t.requestCreate.excelImportFailed);
      }
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: t.requestCreate.requestCreated,
        description: `${t.requestCreate.requestSubmitted} #${data.requestNumber}`,
      });
      navigate(`/requests/${data.id}`);
    } catch (err: any) {
      toast({
        title: t.common.error,
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasError = (condition: boolean) =>
    touched && condition ? "border-destructive" : "";

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t.requestCreate.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <form
          onSubmit={handleSubmit}
          className="max-w-4xl mx-auto space-y-6"
        >
          <Card>
            <CardHeader className="pb-3">
              <h3 className="text-base font-semibold">{t.requestCreate.requestDetails}</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t.requestCreate.requestDate}</Label>
                  <Input
                    type="date"
                    value={today}
                    disabled
                    className="bg-muted cursor-not-allowed"
                    data-testid="input-request-date"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="department">
                    {t.requestCreate.department} <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={department}
                    onValueChange={(v) => {
                      setDepartment(v);
                      setSalesRepId("");
                    }}
                  >
                    <SelectTrigger
                      className={hasError(!department)}
                      data-testid="select-department"
                    >
                      <SelectValue placeholder={t.requestCreate.selectDepartment} />
                    </SelectTrigger>
                    <SelectContent>
                      {departments?.map((dept) => (
                        <SelectItem key={dept.id} value={dept.name}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>
                    {t.requestCreate.productCategory} <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={productCategoryId}
                    onValueChange={(v) => {
                      setProductCategoryId(v);
                      setItems([{ ...EMPTY_ITEM }]);
                    }}
                  >
                    <SelectTrigger
                      className={hasError(!productCategoryId)}
                      data-testid="select-product-category"
                    >
                      <SelectValue placeholder={t.requestCreate.selectProductCategory} />
                    </SelectTrigger>
                    <SelectContent>
                      {productCategories?.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {user?.role === "planning" && (
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      id="strategic-checkbox"
                      checked={salesChannel === "strategic_reservation"}
                      onChange={(e) => setSalesChannel(e.target.checked ? "strategic_reservation" : "")}
                      className="h-4 w-4 rounded border-gray-300"
                      data-testid="checkbox-strategic-reservation"
                    />
                    <Label htmlFor="strategic-checkbox" className="cursor-pointer text-sm font-medium">
                      {isRTL ? "حجز استراتيجي" : "Strategic Reservation"}
                    </Label>
                  </div>
                )}

                {salesChannel === "strategic_reservation" && user?.role === "planning" ? (
                  <div className="space-y-2">
                    <Label>{t.requestCreate.salesRep}</Label>
                    <Input
                      value={user.name}
                      disabled
                      className="bg-muted"
                      data-testid="input-sales-rep-planning"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>
                      {t.requestCreate.salesRep} <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={salesRepId}
                      onValueChange={setSalesRepId}
                    >
                      <SelectTrigger
                        className={hasError(!salesRepId)}
                        data-testid="select-sales-rep"
                      >
                        <SelectValue placeholder={t.requestCreate.selectSalesRep} />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredSalesReps?.map((rep) => (
                          <SelectItem key={rep.id} value={String(rep.id)}>
                            {rep.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="customerAccountNumber">
                    {t.requestCreate.customerAccountNumber} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="customerAccountNumber"
                    placeholder={t.requestCreate.customerAccountNumberPlaceholder}
                    value={customerAccountNumber}
                    onChange={(e) => setCustomerAccountNumber(e.target.value)}
                    className={hasError(!customerAccountNumber.trim())}
                    data-testid="input-customer-account-number"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customerName">
                    {t.requestCreate.customerName} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="customerName"
                    placeholder={t.requestCreate.customerNamePlaceholder}
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className={hasError(!customerName.trim())}
                    data-testid="input-customer-name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="projectName">
                    {t.requestCreate.projectName} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="projectName"
                    placeholder={t.requestCreate.projectNamePlaceholder}
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className={hasError(!projectName.trim())}
                    data-testid="input-project-name"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="space-y-2">
                  <Label>
                    {t.requestCreate.reservationDuration} <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={reservationDuration}
                    onValueChange={setReservationDuration}
                  >
                    <SelectTrigger
                      className={hasError(!reservationDuration)}
                      data-testid="select-reservation-duration"
                    >
                      <SelectValue placeholder={t.requestCreate.selectDuration} />
                    </SelectTrigger>
                    <SelectContent>
                      {reservationDurationOptions.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d} {t.requestCreate.days}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t.requestCreate.endDateAuto}</Label>
                  <Input
                    type="date"
                    value={reservationEndDate}
                    readOnly
                    className="bg-muted cursor-not-allowed"
                    data-testid="input-end-date-auto"
                  />
                </div>

                {requiresPaymentAndPO && (
                  <div className="col-span-full flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-md border border-amber-200 dark:border-amber-800">
                    <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>{t.requestCreate.paymentRequired}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="advancePayment">
                    {t.requestCreate.advancePayment} {!requiresPaymentAndPO && `(${t.requestCreate.optional})`}
                  </Label>
                  <Input
                    id="advancePayment"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={advancePayment}
                    onChange={(e) => setAdvancePayment(e.target.value)}
                    data-testid="input-advance-payment"
                  />
                </div>

                <div className="space-y-2">
                  <Label>
                    {t.requestCreate.accountStatement} {!requiresPaymentAndPO && `(${t.requestCreate.optional})`}
                  </Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      ref={asFileInputRef}
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
                      onChange={handleASUpload}
                      className="hidden"
                      data-testid="input-account-statement-file"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => asFileInputRef.current?.click()}
                      disabled={uploadingAS}
                      data-testid="button-upload-account-statement"
                    >
                      {uploadingAS ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Upload className="w-3 h-3" />
                      )}
                      <span>{asFileName || t.requestCreate.uploadFile}</span>
                    </Button>
                    {asFileName && (
                      <Badge variant="secondary" className="text-xs">
                        {asFileName}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    {t.requestCreate.purchaseOrder} {!requiresPaymentAndPO && `(${t.requestCreate.optional})`}
                  </Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      ref={poFileInputRef}
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={handlePOUpload}
                      className="hidden"
                      data-testid="input-purchase-order-file"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => poFileInputRef.current?.click()}
                      disabled={uploadingPO}
                      data-testid="button-upload-po"
                    >
                      {uploadingPO ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Upload className="w-3 h-3" />
                      )}
                      <span>{poFileName || t.requestCreate.uploadFile}</span>
                    </Button>
                    {poFileName && (
                      <Badge variant="secondary" className="text-xs">
                        {poFileName}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">{t.requestCreate.notesOptional}</Label>
                <Textarea
                  id="notes"
                  placeholder={t.requestCreate.notesPlaceholder}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="resize-none"
                  data-testid="input-request-notes"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-base font-semibold">
                  {t.requestCreate.products} ({items.length})
                </h3>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={useExcel ? "default" : "outline"}
                    size="sm"
                    onClick={() => setUseExcel(!useExcel)}
                    data-testid="button-toggle-excel"
                  >
                    <FileSpreadsheet className="w-3 h-3" />
                    <span>{t.requestCreate.uploadExcel}</span>
                  </Button>
                  {!useExcel && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addItem}
                      data-testid="button-add-product"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{t.requestCreate.addProduct}</span>
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {useExcel && (
                <div className="mb-4 p-4 border border-dashed rounded-md">
                  <div className="flex flex-col items-center gap-3">
                    <FileSpreadsheet className="w-8 h-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground text-center">
                      {t.requestCreate.excelUploadDesc}
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleExcelUpload}
                      className="hidden"
                      data-testid="input-excel-file"
                    />
                    <p className="text-xs font-medium">{t.requestCreate.downloadTemplate}</p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingExcel}
                        data-testid="button-upload-excel"
                      >
                        {uploadingExcel ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        <span>
                          {uploadingExcel
                            ? t.requestCreate.parsing
                            : t.requestCreate.selectExcelFile}
                        </span>
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        asChild
                        data-testid="button-download-template"
                      >
                        <a href="/templates/import_template.xlsx" download>
                          <Download className="w-4 h-4" />
                          <span>{t.requestCreate.downloadTemplate}</span>
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {items.map((item, index) => (
                  <div
                    key={index}
                    className="border rounded-md p-4 space-y-3"
                    data-testid={`row-product-${index}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-muted-foreground">
                        {t.requestCreate.product} {index + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(index)}
                        disabled={items.length <= 1}
                        data-testid={`button-remove-product-${index}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          {t.requestCreate.itemCode} <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                          <Input
                            placeholder={t.requestCreate.itemCodePlaceholder}
                            value={item.itemCode}
                            onChange={(e) => {
                              updateItem(index, "itemCode", e.target.value);
                              lookupProduct(index, e.target.value);
                            }}
                            className={`${hasError(!item.itemCode.trim())} ${item.lookupStatus === "not_found" || item.lookupStatus === "category_mismatch" ? "border-destructive" : ""} ${item.lookupStatus === "found" ? "border-green-500" : ""}`}
                            data-testid={`input-item-code-${index}`}
                          />
                          {item.lookupStatus === "loading" && (
                            <Loader2 className="absolute top-1/2 -translate-y-1/2 end-2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        {item.lookupStatus === "not_found" && item.itemCode.trim() && (
                          <p className="text-xs text-destructive mt-0.5" data-testid={`text-not-found-${index}`}>
                            {t.productsPage.productNotFound}
                          </p>
                        )}
                        {item.lookupStatus === "category_mismatch" && item.itemCode.trim() && (
                          <p className="text-xs text-destructive mt-0.5" data-testid={`text-category-mismatch-${index}`}>
                            {t.requestCreate.productCategoryMismatch}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          {t.requestCreate.itemDescription}{" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          placeholder={t.requestCreate.itemDescPlaceholder}
                          value={item.itemDescription}
                          readOnly
                          className={`${hasError(!item.itemDescription.trim())} bg-muted`}
                          data-testid={`input-item-desc-${index}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          {t.requestCreate.brand} <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          placeholder={t.requestCreate.brandPlaceholder}
                          value={item.brand}
                          readOnly
                          className={`${hasError(!item.brand.trim())} bg-muted`}
                          data-testid={`input-brand-${index}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          {t.productsPage.sellingPrice}
                        </Label>
                        <Input
                          value={item.sellingPrice ? parseFloat(item.sellingPrice).toLocaleString() : ""}
                          readOnly
                          className="bg-muted"
                          data-testid={`input-selling-price-${index}`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          {t.requestCreate.quantity}{" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          value={item.quantityRequested || ""}
                          onChange={(e) =>
                            updateItem(
                              index,
                              "quantityRequested",
                              e.target.value
                            )
                          }
                          className={hasError(
                            !item.quantityRequested ||
                              item.quantityRequested <= 0
                          )}
                          data-testid={`input-product-qty-${index}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          {t.requestCreate.warehouse}{" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <Select
                          value={item.warehouse}
                          onValueChange={(v) =>
                            updateItem(index, "warehouse", v)
                          }
                        >
                          <SelectTrigger
                            className={hasError(!item.warehouse)}
                            data-testid={`select-warehouse-${index}`}
                          >
                            <SelectValue placeholder={t.requestCreate.selectWarehouse} />
                          </SelectTrigger>
                          <SelectContent>
                            {warehouses?.map((w) => (
                              <SelectItem key={w.id} value={w.name}>
                                {w.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {item.warehouse && (() => {
                          const wh = warehouses?.find(w => w.name === item.warehouse);
                          return wh?.location ? (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1" data-testid={`text-warehouse-location-${index}`}>
                              <span className="shrink-0">{t.requestCreate.warehouseLocation}:</span> {wh.location}
                            </p>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {touched && items.length === 0 && (
                <div className="flex items-center gap-2 text-destructive text-sm mt-3">
                  <AlertCircle className="w-4 h-4" />
                  <span>{t.requestCreate.atLeastOneProduct}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-start gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/requests")}
              data-testid="button-cancel-request"
            >
              {t.requestCreate.cancel}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || (touched && !isFormValid())}
              data-testid="button-submit-request"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>{t.requestCreate.submitRequest}</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
