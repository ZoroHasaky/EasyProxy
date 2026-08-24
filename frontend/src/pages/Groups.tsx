import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Save,
  Trash2,
  ArrowUp,
  ArrowDown,
  Globe2,
  Pencil,
} from "lucide-react";
import { api, ProxyGroup, RegionInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const GROUP_TYPES = [
  { value: "select", label: "手动选择 (select)" },
  { value: "url-test", label: "速度优先 (url-test)" },
  { value: "fallback", label: "故障转移 (fallback)" },
  { value: "load-balance", label: "负载均衡 (load-balance)" },
];

function groupTypeLabel(type: ProxyGroup["type"]) {
  return GROUP_TYPES.find((item) => item.value === type)?.label ?? type;
}

let tmpId = 0;

export function GroupsPanel({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<ProxyGroup[] | null>(null);
  const [draft, setDraft] = useState<ProxyGroup | null>(null);
  const [draftIsNew, setDraftIsNew] = useState(false);

  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: () => api.get<ProxyGroup[]>("/api/groups"),
  });
  const regions = useQuery({
    queryKey: ["regions"],
    queryFn: () => api.get<RegionInfo[]>("/api/regions"),
  });
  const nodeRegions = useQuery({
    queryKey: ["nodeRegions"],
    queryFn: () => api.get<RegionInfo[]>("/api/nodes/regions"),
  });

  useEffect(() => {
    if (items === null && groups.data) {
      setItems(groups.data.map((g) => ({ ...g })));
    }
  }, [groups.data, items]);

  const save = useMutation({
    mutationFn: () => api.put("/api/groups", items ?? []),
    onSuccess: () => {
      toast.success("策略组已保存（在内核页应用配置后生效）");
      qc.invalidateQueries({ queryKey: ["groups"] });
      setItems(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const genRegions = useMutation({
    mutationFn: () =>
      api.post<{ created: string[] }>("/api/groups/generate-regions"),
    onSuccess: (res) => {
      toast.success(
        res.created.length
          ? `已生成地区分组：${res.created.join("、")}`
          : "地区分组已齐全",
      );
      setItems(null);
      qc.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const move = (idx: number, dir: -1 | 1) =>
    setItems((rs) => {
      if (!rs) return rs;
      const j = idx + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
  const openAdd = () => {
    setDraftIsNew(true);
    setDraft({
      id: --tmpId,
      name: "",
      type: "select",
      region: "",
      include_regex: "",
      test_url: "",
      interval: 300,
      tolerance: 50,
      icon: "",
      position: 0,
      enabled: true,
    });
  };
  const openEdit = (group: ProxyGroup) => {
    setDraftIsNew(false);
    setDraft({ ...group });
  };
  const commitDraft = () => {
    if (!draft) return;
    const next = {
      ...draft,
      name: draft.name.trim(),
      icon: draft.icon.trim(),
      region: draft.region.trim(),
      include_regex: draft.include_regex.trim(),
      test_url: draft.test_url.trim(),
      interval: draft.interval || 300,
      tolerance: draft.tolerance || 0,
    };
    if (!next.name) {
      toast.error("策略组名称不能为空");
      return;
    }
    if ((items ?? []).some((group) => group.id !== next.id && group.name === next.name)) {
      toast.error(`策略组名称重复：${next.name}`);
      return;
    }
    setItems((groups) =>
      draftIsNew
        ? [...(groups ?? []), next]
        : (groups ?? []).map((group) => (group.id === next.id ? next : group)),
    );
    setDraft(null);
  };
  const deleteGroup = (group: ProxyGroup) => {
    if (!confirm(`确定删除策略组“${group.name}”？引用它的规则应用时将回退代理。`)) return;
    setItems((groups) => (groups ?? []).filter((item) => item.id !== group.id));
  };

  const memberHint = (g: ProxyGroup): string => {
    if (g.region) {
      const r = nodeRegions.data?.find((x) => x.code === g.region);
      return `按地区匹配 ${g.region}（当前 ${r?.count ?? 0} 个节点）`;
    }
    if (g.include_regex) return `按正则 /${g.include_regex}/ 匹配节点名`;
    return "匹配全部启用节点";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {!embedded && <h1 className="text-xl font-semibold">策略组</h1>}
          <p
            className={
              embedded
                ? "text-xs text-muted-foreground"
                : "text-sm text-muted-foreground"
            }
          >
            内置 PROXY（主出口选择）与 AUTO（全节点速度优先）；下方为自定义分组
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => genRegions.mutate()}
            disabled={genRegions.isPending}
          >
            <Globe2 className="h-4 w-4" /> 生成地区分组
          </Button>
          <Button variant="outline" onClick={openAdd}>
            <Plus className="h-4 w-4" /> 添加策略组
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={items === null || save.isPending}
          >
            <Save className="h-4 w-4" /> 保存
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {(items ?? []).map((g, idx) => (
          <Card key={g.id} className={cn2(!g.enabled)}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{g.icon || "🚀"}</span>
                    <span className="truncate font-medium">{g.name}</span>
                    <Badge variant={g.enabled ? "success" : "secondary"}>
                      {g.enabled ? "启用" : "停用"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {groupTypeLabel(g.type)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    title="上移"
                    onClick={() => move(idx, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="下移"
                    onClick={() => move(idx, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="修改策略组"
                    onClick={() => openEdit(g)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="删除策略组"
                    onClick={() => deleteGroup(g)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="rounded-md bg-muted/30 p-3 text-sm">
                {memberHint(g)}
              </div>
              {g.type !== "select" && (
                <div className="text-xs text-muted-foreground">
                  测速地址：{g.test_url || "默认 gstatic 204"} · 间隔：
                  {g.interval} 秒
                  {g.type === "url-test" ? ` · 容差：${g.tolerance} ms` : ""}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {(items ?? []).length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          暂无自定义分组；点击「生成地区分组」可按节点池一键创建各地区 url-test
          分组
        </div>
      )}

      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {draftIsNew ? "添加策略组" : "修改策略组"}
            </DialogTitle>
            <DialogDescription>
              设置策略组类型、节点筛选和测速参数。
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label>启用策略组</Label>
                  <p className="text-xs text-muted-foreground">
                    停用后不会写入最终配置。
                  </p>
                </div>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
                />
              </div>
              <div className="grid grid-cols-[90px_1fr] gap-3">
                <div className="space-y-1.5">
                  <Label>图标</Label>
                  <Input
                    value={draft.icon}
                    placeholder="🚀"
                    onChange={(event) =>
                      setDraft({ ...draft, icon: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>名称</Label>
                  <Input
                    value={draft.name}
                    placeholder="唯一名称"
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>类型</Label>
                  <Select
                    value={draft.type}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        type: event.target.value as ProxyGroup["type"],
                      })
                    }
                  >
                    {GROUP_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>地区筛选</Label>
                  <Select
                    value={draft.region}
                    onChange={(event) =>
                      setDraft({ ...draft, region: event.target.value })
                    }
                  >
                    <option value="">（不按地区）</option>
                    {(regions.data ?? []).map((region) => (
                      <option key={region.code} value={region.code}>
                        {region.flag} {region.cn}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>名称正则</Label>
                <Input
                  value={draft.include_regex}
                  placeholder="与地区筛选二选一；都为空时匹配全部节点"
                  onChange={(event) =>
                    setDraft({ ...draft, include_regex: event.target.value })
                  }
                />
              </div>
              {draft.type !== "select" && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>测速 URL</Label>
                    <Input
                      value={draft.test_url}
                      placeholder="默认 gstatic 204"
                      onChange={(event) =>
                        setDraft({ ...draft, test_url: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>间隔（秒）</Label>
                    <Input
                      type="number"
                      value={draft.interval}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          interval: Number(event.target.value) || 300,
                        })
                      }
                    />
                  </div>
                  {draft.type === "url-test" && (
                    <div className="space-y-1.5">
                      <Label>容差（ms）</Label>
                      <Input
                        type="number"
                        value={draft.tolerance}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            tolerance: Number(event.target.value) || 0,
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button onClick={commitDraft}>
              {draftIsNew ? "添加" : "确认修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function GroupsPage() {
  return <GroupsPanel />;
}

function cn2(cond: boolean): string {
  return cond ? "opacity-60" : "";
}
