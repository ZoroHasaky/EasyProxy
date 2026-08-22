import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save, Trash2, ArrowUp, ArrowDown, Globe2 } from "lucide-react";
import { api, ProxyGroup, RegionInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

const GROUP_TYPES = [
  { value: "select", label: "手动选择 (select)" },
  { value: "url-test", label: "速度优先 (url-test)" },
  { value: "fallback", label: "故障转移 (fallback)" },
  { value: "load-balance", label: "负载均衡 (load-balance)" },
];

let tmpId = 100000;

export default function GroupsPage() {
  const qc = useQueryClient();
  const [items, setItems] = useState<ProxyGroup[] | null>(null);

  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api.get<ProxyGroup[]>("/api/groups") });
  const regions = useQuery({ queryKey: ["regions"], queryFn: () => api.get<RegionInfo[]>("/api/regions") });
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
      toast.success("策略组已保存（在部署页或规则页应用配置后生效）");
      qc.invalidateQueries({ queryKey: ["groups"] });
      setItems(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const genRegions = useMutation({
    mutationFn: () => api.post<{ created: string[] }>("/api/groups/generate-regions"),
    onSuccess: (res) => {
      toast.success(res.created.length ? `已生成地区分组：${res.created.join("、")}` : "地区分组已齐全");
      setItems(null);
      qc.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const update = (id: number, patch: Partial<ProxyGroup>) =>
    setItems((rs) => (rs ?? []).map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const move = (idx: number, dir: -1 | 1) =>
    setItems((rs) => {
      if (!rs) return rs;
      const j = idx + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
  const add = () =>
    setItems((rs) => [
      ...(rs ?? []),
      {
        id: ++tmpId, name: "", type: "select", region: "", include_regex: "", test_url: "",
        interval: 300, tolerance: 50, icon: "", position: 0, enabled: true,
      },
    ]);

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
          <h1 className="text-xl font-semibold">策略组</h1>
          <p className="text-sm text-muted-foreground">
            内置 PROXY（主出口选择）与 AUTO（全节点速度优先）；下方为自定义分组
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => genRegions.mutate()} disabled={genRegions.isPending}>
            <Globe2 className="h-4 w-4" /> 生成地区分组
          </Button>
          <Button variant="outline" onClick={add}>
            <Plus className="h-4 w-4" /> 新增分组
          </Button>
          <Button onClick={() => save.mutate()} disabled={items === null || save.isPending}>
            <Save className="h-4 w-4" /> 保存
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {(items ?? []).map((g, idx) => (
          <Card key={g.id} className={cn2(!g.enabled)}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Input className="w-14 text-center" value={g.icon} placeholder="🚀"
                  onChange={(e) => update(g.id, { icon: e.target.value })} />
                <Input value={g.name} placeholder="分组名称（唯一）"
                  onChange={(e) => update(g.id, { name: e.target.value })} />
                <Switch checked={g.enabled} onCheckedChange={(v) => update(g.id, { enabled: v })} />
                <Button size="icon" variant="ghost" onClick={() => move(idx, -1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => move(idx, 1)}><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost"
                  onClick={() => setItems((rs) => (rs ?? []).filter((x) => x.id !== g.id))}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">类型</Label>
                  <Select value={g.type} onChange={(e) => update(g.id, { type: e.target.value as ProxyGroup["type"] })}>
                    {GROUP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">地区筛选</Label>
                  <Select value={g.region} onChange={(e) => update(g.id, { region: e.target.value })}>
                    <option value="">（不按地区）</option>
                    {(regions.data ?? []).map((r) => (
                      <option key={r.code} value={r.code}>{r.flag} {r.cn}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">或按名称正则（与地区二选一，都空则匹配全部）</Label>
                <Input value={g.include_regex} placeholder="如 ^(HK|香港)"
                  onChange={(e) => update(g.id, { include_regex: e.target.value })} />
              </div>
              {g.type !== "select" && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">测速 URL</Label>
                    <Input value={g.test_url} placeholder="默认 gstatic 204"
                      onChange={(e) => update(g.id, { test_url: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">间隔(秒)</Label>
                    <Input type="number" value={g.interval}
                      onChange={(e) => update(g.id, { interval: Number(e.target.value) || 300 })} />
                  </div>
                  {g.type === "url-test" && (
                    <div className="space-y-1">
                      <Label className="text-xs">容差(ms)</Label>
                      <Input type="number" value={g.tolerance}
                        onChange={(e) => update(g.id, { tolerance: Number(e.target.value) || 0 })} />
                    </div>
                  )}
                </div>
              )}
              <Badge variant="outline">{memberHint(g)}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
      {(items ?? []).length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          暂无自定义分组；点击「生成地区分组」可按节点池一键创建各地区 url-test 分组
        </div>
      )}
    </div>
  );
}

function cn2(cond: boolean): string {
  return cond ? "opacity-60" : "";
}
