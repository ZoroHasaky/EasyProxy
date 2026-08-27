import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  ArrowRight,
  Eye,
  FileUp,
  Layers,
  Pencil,
  Plus,
  Radio,
  Route,
  ScrollText,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { api, autoApplyResultMessage, AutoApplyResponse, GenResult, GeoRecognitionGenerationResponse, GeoRecognitionPresetCatalog, mihomo, OutboundRule, OutboundSimulation, proxyGroupTypeLabel, ProxyGroup, QuickGeoRoutingGenerationResponse, RecognitionRule, RecognitionRuleImportResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GroupsPanel } from "@/pages/Groups";
import { cn } from "@/lib/utils";
import { defineMessages, useLanguage, useMessages } from "@/contexts/language";

const RECOGNITION_KINDS = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "DOMAIN-REGEX",
  "IP-CIDR",
  "IP-CIDR6",
  "GEOIP",
  "GEOSITE",
  "SRC-IP-CIDR",
  "SRC-PORT",
  "DST-PORT",
  "PROCESS-NAME",
  "PROCESS-PATH",
  "IN-TYPE",
  "RULE-SET",
  "MATCH",
];

const messages = defineMessages({
  kindDomain: "完整域名", kindDomainSuffix: "域名后缀", kindDomainKeyword: "域名关键字", kindDomainRegex: "域名正则",
  kindIpCidr: "IP 网段", kindIpCidr6: "IPv6 网段", kindGeoIp: "GeoIP 国家", kindGeoSite: "GeoSite 分类",
  kindSrcIpCidr: "来源 IP 网段", kindSrcPort: "来源端口", kindDstPort: "目标端口", kindProcessName: "进程名称",
  kindProcessPath: "进程路径", kindInType: "入站类型", kindRuleSet: "远程 YAML 规则集", kindMatch: "最终兜底",
  direct: "直连", directDescription: "不经过代理，直接连接目标", reject: "拒绝", rejectDescription: "直接拒绝匹配到的连接",
  proxy: "主代理出口", proxyDescription: "由仪表盘的主代理出口选择决定最终出站", noProxySelection: "内核未运行或尚未选择",
  autoSelection: "自动测速（AUTO）", recognitionTitle: "识别规则", recognitionDescription: "每条规则可填写多个匹配条件；优先级数值越大，越早参与匹配。",
  importYaml: "导入 YAML 规则源", quickGenerateTitle: "选择 Geo 规则或通用配置生成方式", quickGenerating: "一键生成中…",
  quickGenerate: "一键生成", addRecognition: "新建识别规则", unconditional: "无条件，作为最终兜底", priorityBadge: "优先级 {value}",
  yamlSource: "YAML 规则源 · 每 {seconds} 秒更新", conditionCount: "匹配条件（{count}）", mapped: "已配置出站映射",
  unmapped: "尚未配置出站映射", edit: "编辑", removeRecognition: "删除识别规则", noRecognition: "暂无识别规则",
  noRecognitionDescription: "新建规则后，可在一条规则中填写多个域名、网段或其他匹配条件。", outboundTitle: "出站映射",
  outboundDescription: "绑定“识别规则 → 内置出站目标或节点组合”，决定最终的流量处理方式。", outboundTest: "出站测试",
  previewYaml: "预览 YAML", addOutbound: "新建出站映射", deletedRecognition: "已删除的识别规则", builtinHandling: "交由内置目标处理",
  groupHandling: "交由节点组合处理", outboundTarget: "出站目标", deletedGroup: "已删除的节点组合", currentSelection: "当前选择：{selection}",
  manualNodeCount: "手选 {count} 节点", groupStrategy: "按组合策略选择", removeOutbound: "删除出站映射", noOutbound: "暂无出站映射",
  noOutboundDescription: "先创建识别规则，再绑定直连、拒绝、主代理出口或节点组合。", applyFailed: "{message}，但自动应用失败，已加入待应用清单",
  applied: "{message}，{result}", geoGenerated: "已根据 Geo 数据生成 {count} 条识别规则{skipped}", skippedCount: "，跳过 {count} 条",
  noGeoAdded: "没有可新增的 Geo 识别规则，已跳过 {count} 条", skippedExisting: "，跳过 {count} 条已有规则",
  quickGeneratedResult: "Geo 数据已刷新，已生成 {rules} 条识别规则和 {mappings} 条出站映射{skipped}",
  noQuickAdded: "Geo 数据已刷新，没有可新增的常用规则{skipped}", remoteRequired: "请填写规则名称和 YAML 来源 URL",
  conditionsRequired: "请填写规则名称和至少一个匹配条件", recognitionUpdated: "识别规则已更新", recognitionCreated: "识别规则已创建",
  importedResult: "已导入 {count} 条 YAML 识别规则", confirmRemoveRecognition: "确定删除识别规则「{name}」吗？请先删除它关联的出站映射。",
  recognitionDeleted: "识别规则已删除", recognitionEnabled: "识别规则已启用", recognitionDisabled: "识别规则已禁用",
  outboundRequired: "请选择识别规则和出站目标", outboundUpdated: "出站映射已更新", outboundCreated: "已创建 {count} 条出站映射",
  confirmRemoveOutbound: "确定删除这条出站映射吗？", outboundDeleted: "出站映射已删除", outboundEnabled: "出站映射已启用",
  outboundDisabled: "出站映射已禁用", recognitionTab: "识别规则（{count}）", groupsTab: "节点组合（{count}）", outboundTab: "出站映射（{count}）",
  editRecognitionTitle: "编辑识别规则", newRecognitionTitle: "新建识别规则", recognitionDialogDescription: "同一识别规则可按行填写多个条件，生成时会展开为多条同优先级的 Mihomo 规则。",
  name: "名称", namePlaceholder: "例如：PT 站点", recognitionScope: "识别范围", priority: "优先级", priorityHint: "默认 0，数字越大越优先。",
  remoteHint: "远程 YAML 规则集由 Mihomo 自动下载和更新；不支持 MRS 文件。", yamlSourceUrl: "YAML 来源 URL", behavior: "匹配类型",
  behaviorDomain: "域名（domain）", behaviorIpCidr: "IP 网段（ipcidr）", behaviorClassical: "传统规则（classical）", intervalSeconds: "更新周期（秒）",
  conditions: "匹配条件（每行一个）", conditionPlaceholder: "每行填写一个匹配条件", matchHint: "MATCH 不需要条件，会匹配所有尚未命中的流量。请设置较低优先级，作为最终兜底。",
  enableRecognition: "启用此识别规则", enableRecognitionHint: "禁用后不会写入 Mihomo 配置。", cancel: "取消", saving: "保存中…", saveRecognition: "保存识别规则",
  importDialogTitle: "导入 YAML 识别规则源", importDialogDescription: "支持单个 YAML 地址、包含 rule-providers 的配置，以及 MetaCubeX 等来源的 payload 规则文件；请再在“出站映射”中决定实际节点组合。",
  singleYamlUrl: "单个 YAML URL", pasteYaml: "粘贴 YAML 配置", yamlFileUrl: "YAML 文件 URL", optionalName: "名称（可选）",
  optionalNameHint: "留空时从 YAML 文件名推导", yamlConfig: "YAML 配置或规则文件", yamlPlaceholder: "批量配置：\nrule-providers:\n  apple:\n    type: http\n    behavior: domain\n    url: https://example.com/apple.yaml\n    format: yaml\n\n或粘贴单个规则文件：\npayload:\n  - +.github.com",
  payloadDetected: "检测到单个 payload 规则文件。请填写它的远程来源，Mihomo 会从该地址自动更新规则。", ruleFileUrl: "规则文件 URL",
  importParseHint: "批量配置会读取其中的来源信息；单个规则文件会校验 payload，并使用上方填写的来源。下载路径由 EasyProxy 自动生成。",
  parsing: "解析中…", parseConfig: "解析配置", parsedResult: "已解析 {count} 个规则源：{names}", importPriorityHint: "默认 0，数字越大越先匹配。",
  enableAfterImport: "导入后启用", enableAfterImportHint: "未映射前不会写入内核配置。", importing: "导入中…", importRecognition: "导入识别规则",
  quickDialogDescription: "选择要执行的生成方式。", geoRecognitionOption: "根据 Geo 生成识别规则",
  geoRecognitionOptionDescription: "选择本机已下载 Geo 数据中的分类，生成识别规则；不会创建出站映射。", commonConfigOption: "一键生成通用配置",
  commonConfigOptionDescription: "刷新 Geo 数据，生成常用规则并创建大陆直连、其他主代理出口的出站映射。", geoDialogTitle: "根据 Geo 自动生成识别规则",
  geoDialogDescription: "仅根据本地已拉取且可解析的 Geo 数据生成规则。生成后还需在“出站映射”中绑定节点组合，当前流量不会因此改变。",
  noGeoData: "未检测到可用 Geo 数据", geoRequiredHint: "请先在 Geo 数据页面启用 Geo 数据、应用配置并手动更新，然后再回来生成识别规则。",
  goToGeo: "前往 Geo 数据", geoSelectionHint: "已默认选中当前数据中可用的日常规则。所有新规则均启用，优先级为 1；已存在相同条件或名称冲突的规则会在生成时自动跳过。",
  generating: "生成中…", generateRules: "生成 {count} 条规则", geoPrivateIp: "私有地址", geoPrivateDomain: "私有域名", geoChinaIp: "中国大陆 IP",
  geoChinaDomain: "中国大陆域名", geoAds: "广告服务", geoGoogle: "Google 服务", geoApple: "Apple 服务", geoMicrosoft: "Microsoft 服务",
  geoGithub: "GitHub", geoOpenAi: "OpenAI", geoTelegram: "Telegram", editOutboundTitle: "编辑出站映射", newOutboundTitle: "新建出站映射",
  editOutboundDescription: "调整这条识别规则的出站目标。", newOutboundDescription: "可一次选择多条尚未绑定的识别规则，并将它们绑定到同一个出站目标。",
  selectRecognition: "请选择识别规则", noUnmappedRecognition: "没有尚未绑定的识别规则", selectedRecognition: "已选择 {count} 条识别规则。",
  selectOutbound: "请选择出站目标", builtinTargets: "内置出站目标", proxyGroups: "节点组合", disabledSuffix: "，已禁用",
  enableOutbound: "启用此出站映射", enableOutboundHint: "关闭后该识别规则不参与路由。", saveOutbound: "保存出站映射",
  outboundTestDescription: "不会访问目标或解析 DNS；会使用本机已下载的 Geo 数据和 YAML 规则集缓存推演链路，不会下载远程规则。",
  targetRequired: "请输入域名或 IP 地址", accessTarget: "访问目标", targetPlaceholder: "例如 github.com 或 1.1.1.1", certain: "可确定",
  uncertain: "存在待确认规则", matchedRule: "命中规则", condition: "条件", simulatedRoute: "模拟链路", close: "关闭", simulating: "推演中…",
  startTest: "开始测试", previewTitle: "预览生成配置", previewDescription: "识别规则会按照优先级从大到小展开，然后映射到相应节点组合。",
  previewGenerating: "正在生成配置…",
}, {
  kindDomain: "Exact Domain", kindDomainSuffix: "Domain Suffix", kindDomainKeyword: "Domain Keyword", kindDomainRegex: "Domain Regex",
  kindIpCidr: "IP CIDR", kindIpCidr6: "IPv6 CIDR", kindGeoIp: "GeoIP Country", kindGeoSite: "GeoSite Category",
  kindSrcIpCidr: "Source IP CIDR", kindSrcPort: "Source Port", kindDstPort: "Destination Port", kindProcessName: "Process Name",
  kindProcessPath: "Process Path", kindInType: "Inbound Type", kindRuleSet: "Remote YAML Rule Set", kindMatch: "Final Fallback",
  direct: "Direct", directDescription: "Connect directly without a proxy", reject: "Reject", rejectDescription: "Reject matching connections immediately",
  proxy: "Primary Proxy", proxyDescription: "Use the primary proxy selection from the dashboard", noProxySelection: "Kernel not running or no selection yet",
  autoSelection: "Auto Test (AUTO)", recognitionTitle: "Recognition Rules", recognitionDescription: "Each rule can contain multiple conditions. Higher priority values match first.",
  importYaml: "Import YAML Rule Source", quickGenerateTitle: "Choose Geo rule or common configuration generation", quickGenerating: "Generating…",
  quickGenerate: "One-click Generate", addRecognition: "New Recognition Rule", unconditional: "Unconditional final fallback", priorityBadge: "Priority {value}",
  yamlSource: "YAML rule source · updates every {seconds} seconds", conditionCount: "Conditions ({count})", mapped: "Outbound mapping configured",
  unmapped: "No outbound mapping", edit: "Edit", removeRecognition: "Delete Recognition Rule", noRecognition: "No recognition rules",
  noRecognitionDescription: "Create a rule with one or more domains, networks, or other matching conditions.", outboundTitle: "Outbound Mappings",
  outboundDescription: "Bind recognition rules to built-in outbound targets or proxy groups to control traffic handling.", outboundTest: "Test Outbound",
  previewYaml: "Preview YAML", addOutbound: "New Outbound Mapping", deletedRecognition: "Deleted recognition rule", builtinHandling: "Handled by built-in target",
  groupHandling: "Handled by proxy group", outboundTarget: "Outbound Target", deletedGroup: "Deleted proxy group", currentSelection: "Current selection: {selection}",
  manualNodeCount: "{count} manually selected nodes", groupStrategy: "Selected by group strategy", removeOutbound: "Delete Outbound Mapping", noOutbound: "No outbound mappings",
  noOutboundDescription: "Create a recognition rule, then bind it to Direct, Reject, Primary Proxy, or a proxy group.", applyFailed: "{message}, but automatic apply failed and the change was added to the pending list",
  applied: "{message}; {result}", geoGenerated: "Generated {count} recognition rules from Geo data{skipped}", skippedCount: "; skipped {count}",
  noGeoAdded: "No new Geo recognition rules; skipped {count}", skippedExisting: "; skipped {count} existing rules",
  quickGeneratedResult: "Geo data refreshed; generated {rules} recognition rules and {mappings} outbound mappings{skipped}",
  noQuickAdded: "Geo data refreshed; no new common rules{skipped}", remoteRequired: "Enter a rule name and YAML source URL",
  conditionsRequired: "Enter a rule name and at least one matching condition", recognitionUpdated: "Recognition rule updated", recognitionCreated: "Recognition rule created",
  importedResult: "Imported {count} YAML recognition rules", confirmRemoveRecognition: "Delete recognition rule “{name}”? Remove its outbound mapping first.",
  recognitionDeleted: "Recognition rule deleted", recognitionEnabled: "Recognition rule enabled", recognitionDisabled: "Recognition rule disabled",
  outboundRequired: "Select recognition rules and an outbound target", outboundUpdated: "Outbound mapping updated", outboundCreated: "Created {count} outbound mappings",
  confirmRemoveOutbound: "Delete this outbound mapping?", outboundDeleted: "Outbound mapping deleted", outboundEnabled: "Outbound mapping enabled",
  outboundDisabled: "Outbound mapping disabled", recognitionTab: "Recognition Rules ({count})", groupsTab: "Proxy Groups ({count})", outboundTab: "Outbound Mappings ({count})",
  editRecognitionTitle: "Edit Recognition Rule", newRecognitionTitle: "New Recognition Rule", recognitionDialogDescription: "Enter multiple conditions one per line. They expand into Mihomo rules with the same priority.",
  name: "Name", namePlaceholder: "For example: PT Sites", recognitionScope: "Recognition Scope", priority: "Priority", priorityHint: "Default: 0. Higher values match first.",
  remoteHint: "Mihomo downloads and updates remote YAML rule sets automatically. MRS files are not supported.", yamlSourceUrl: "YAML Source URL", behavior: "Behavior",
  behaviorDomain: "Domain", behaviorIpCidr: "IP CIDR", behaviorClassical: "Classical", intervalSeconds: "Update Interval (seconds)",
  conditions: "Conditions (one per line)", conditionPlaceholder: "Enter one matching condition per line", matchHint: "MATCH has no conditions and catches all otherwise unmatched traffic. Give it a low priority as the final fallback.",
  enableRecognition: "Enable Recognition Rule", enableRecognitionHint: "Disabled rules are omitted from the Mihomo configuration.", cancel: "Cancel", saving: "Saving…", saveRecognition: "Save Recognition Rule",
  importDialogTitle: "Import YAML Recognition Rules", importDialogDescription: "Supports individual YAML URLs, configurations containing rule-providers, and payload rule files from MetaCubeX and similar sources. Choose their proxy groups in Outbound Mappings afterward.",
  singleYamlUrl: "Single YAML URL", pasteYaml: "Paste YAML Configuration", yamlFileUrl: "YAML File URL", optionalName: "Name (optional)",
  optionalNameHint: "Derived from the YAML filename when empty", yamlConfig: "YAML Configuration or Rule File", yamlPlaceholder: "Bulk configuration:\nrule-providers:\n  apple:\n    type: http\n    behavior: domain\n    url: https://example.com/apple.yaml\n    format: yaml\n\nOr paste an individual rule file:\npayload:\n  - +.github.com",
  payloadDetected: "An individual payload rule file was detected. Enter its remote source so Mihomo can update it automatically.", ruleFileUrl: "Rule File URL",
  importParseHint: "Bulk configurations use their embedded source settings. Individual rule files validate the payload and use the source above. EasyProxy generates the download path.",
  parsing: "Parsing…", parseConfig: "Parse Configuration", parsedResult: "Parsed {count} rule sources: {names}", importPriorityHint: "Default: 0. Higher values match first.",
  enableAfterImport: "Enable After Import", enableAfterImportHint: "Rules are omitted from the kernel configuration until mapped.", importing: "Importing…", importRecognition: "Import Recognition Rules",
  quickDialogDescription: "Choose a generation method.", geoRecognitionOption: "Generate Recognition Rules from Geo",
  geoRecognitionOptionDescription: "Select categories from locally downloaded Geo data. This does not create outbound mappings.", commonConfigOption: "Generate Common Configuration",
  commonConfigOptionDescription: "Refresh Geo data, create common rules, and map mainland China directly with other traffic using the primary proxy.", geoDialogTitle: "Generate Recognition Rules from Geo",
  geoDialogDescription: "Generate rules only from locally downloaded and readable Geo data. Bind them in Outbound Mappings afterward; current traffic remains unchanged.",
  noGeoData: "No usable Geo data detected", geoRequiredHint: "Enable Geo data, apply the settings, and update it manually on the Geo Data page before generating recognition rules.",
  goToGeo: "Go to Geo Data", geoSelectionHint: "Available everyday rules are selected by default. New rules are enabled with priority 1; duplicate conditions and name conflicts are skipped.",
  generating: "Generating…", generateRules: "Generate {count} Rules", geoPrivateIp: "Private Addresses", geoPrivateDomain: "Private Domains", geoChinaIp: "Mainland China IP",
  geoChinaDomain: "Mainland China Domains", geoAds: "Advertising Services", geoGoogle: "Google Services", geoApple: "Apple Services", geoMicrosoft: "Microsoft Services",
  geoGithub: "GitHub", geoOpenAi: "OpenAI", geoTelegram: "Telegram", editOutboundTitle: "Edit Outbound Mapping", newOutboundTitle: "New Outbound Mapping",
  editOutboundDescription: "Change the outbound target for this recognition rule.", newOutboundDescription: "Select multiple unmapped recognition rules and bind them to one outbound target.",
  selectRecognition: "Select a recognition rule", noUnmappedRecognition: "No unmapped recognition rules", selectedRecognition: "{count} recognition rules selected.",
  selectOutbound: "Select an outbound target", builtinTargets: "Built-in Outbound Targets", proxyGroups: "Proxy Groups", disabledSuffix: ", disabled",
  enableOutbound: "Enable Outbound Mapping", enableOutboundHint: "When disabled, the recognition rule does not participate in routing.", saveOutbound: "Save Outbound Mapping",
  outboundTestDescription: "Does not access the target or resolve DNS. Uses locally downloaded Geo data and cached YAML rule sets to simulate the route without downloading remote rules.",
  targetRequired: "Enter a domain or IP address", accessTarget: "Target", targetPlaceholder: "For example github.com or 1.1.1.1", certain: "Certain",
  uncertain: "Contains Uncertain Rules", matchedRule: "Matched Rule", condition: "Condition", simulatedRoute: "Simulated Route", close: "Close", simulating: "Simulating…",
  startTest: "Start Test", previewTitle: "Preview Generated Configuration", previewDescription: "Recognition rules expand from highest to lowest priority, then map to their proxy groups.",
  previewGenerating: "Generating configuration…",
});

const KIND_LABEL_KEYS: Record<string, keyof typeof messages["zh-CN"]> = {
  DOMAIN: "kindDomain", "DOMAIN-SUFFIX": "kindDomainSuffix", "DOMAIN-KEYWORD": "kindDomainKeyword", "DOMAIN-REGEX": "kindDomainRegex",
  "IP-CIDR": "kindIpCidr", "IP-CIDR6": "kindIpCidr6", GEOIP: "kindGeoIp", GEOSITE: "kindGeoSite", "SRC-IP-CIDR": "kindSrcIpCidr",
  "SRC-PORT": "kindSrcPort", "DST-PORT": "kindDstPort", "PROCESS-NAME": "kindProcessName", "PROCESS-PATH": "kindProcessPath",
  "IN-TYPE": "kindInType", "RULE-SET": "kindRuleSet", MATCH: "kindMatch",
};

const GEO_PRESET_NAME_KEYS: Record<string, keyof typeof messages["zh-CN"]> = {
  "private-ip": "geoPrivateIp", "private-domain": "geoPrivateDomain", "cn-ip": "geoChinaIp", "cn-domain": "geoChinaDomain",
  ads: "geoAds", google: "geoGoogle", apple: "geoApple", microsoft: "geoMicrosoft", github: "geoGithub", openai: "geoOpenAi", telegram: "geoTelegram",
};

const BUILTIN_OUTBOUND_TARGETS = [
  { id: -1, nameKey: "direct", target: "DIRECT", descriptionKey: "directDescription" },
  { id: -2, nameKey: "reject", target: "REJECT", descriptionKey: "rejectDescription" },
  { id: -3, nameKey: "proxy", target: "PROXY", descriptionKey: "proxyDescription" },
] as const;

function builtinOutboundTarget(id: number) {
  return BUILTIN_OUTBOUND_TARGETS.find((target) => target.id === id);
}

function proxySelectionLabel(selection: string | undefined, text: typeof messages["zh-CN"] | typeof messages.en) {
  if (!selection) return text.noProxySelection;
  return selection === "AUTO" ? text.autoSelection : selection;
}

function kindLabel(kind: string, text: typeof messages["zh-CN"] | typeof messages.en) {
  const labelKey = KIND_LABEL_KEYS[kind];
  return `${labelKey ? text[labelKey] : kind} (${kind})`;
}

function geoPresetLabel(id: string, fallback: string, text: typeof messages["zh-CN"] | typeof messages.en) {
  const labelKey = GEO_PRESET_NAME_KEYS[id];
  return labelKey ? text[labelKey] : fallback;
}

function RecognitionRulesPanel({
  rules,
  mappedRecognitionIDs,
  onAdd,
  onImport,
  onQuickGenerate,
  quickGenerating,
  onEdit,
  onToggle,
  onDelete,
}: {
  rules: RecognitionRule[];
  mappedRecognitionIDs: Set<number>;
  onAdd: () => void;
  onImport: () => void;
  onQuickGenerate: () => void;
  quickGenerating: boolean;
  onEdit: (rule: RecognitionRule) => void;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (rule: RecognitionRule) => void;
}) {
  const text = useMessages(messages);
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
            <ScrollText className="h-4.5 w-4.5 text-primary" />
            {text.recognitionTitle}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {text.recognitionDescription}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onImport}>
            <FileUp className="h-4 w-4" />
            {text.importYaml}
          </Button>
          <Button size="sm" onClick={onQuickGenerate} disabled={quickGenerating} title={text.quickGenerateTitle}>
            <WandSparkles className="h-4 w-4" />
            {quickGenerating ? text.quickGenerating : text.quickGenerate}
          </Button>
          <Button size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            {text.addRecognition}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rules.map((rule) => {
          const isRemoteSource = Boolean(rule.source_url);
          const preview = isRemoteSource
            ? `${rule.source_behavior ?? "domain"} · ${rule.source_url}`
            : rule.kind === "MATCH" ? text.unconditional : rule.conditions.join(" · ");
          return (
            <div
              key={rule.id}
              className={cn(
                "flex min-h-56 flex-col justify-between rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-sm transition-all hover:border-primary/40",
                !rule.enabled && "opacity-55",
              )}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{rule.name}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{kindLabel(rule.kind, text)}</div>
                  </div>
                  <Badge variant="purple" className="shrink-0 font-mono text-[10px]">
                    {text.priorityBadge.replace("{value}", String(rule.priority))}
                  </Badge>
                </div>
                <div className="rounded-xl border border-border/50 bg-muted/35 p-3">
                  <div className="text-[11px] text-muted-foreground">{isRemoteSource ? text.yamlSource.replace("{seconds}", String(rule.source_interval ?? 86400)) : text.conditionCount.replace("{count}", String(rule.conditions.length))}</div>
                  <div className="mt-1.5 line-clamp-3 break-all font-mono text-xs" title={preview}>
                    {preview}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {mappedRecognitionIDs.has(rule.id) ? text.mapped : text.unmapped}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3">
                <Switch checked={rule.enabled} onCheckedChange={(enabled) => onToggle(rule.id, enabled)} />
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onEdit(rule)}>
                    <Pencil className="h-3.5 w-3.5" /> {text.edit}
                  </Button>
                  <Button variant="ghost" size="iconSm" title={text.removeRecognition} onClick={() => onDelete(rule)}>
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {rules.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 py-12 text-center">
          <ScrollText className="mx-auto mb-2 h-10 w-10 text-muted-foreground/40" />
          <h4 className="text-sm font-semibold">{text.noRecognition}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{text.noRecognitionDescription}</p>
        </div>
      )}
    </div>
  );
}

function OutboundRulesPanel({
  rules,
  recognitionRules,
  groups,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
  onPreview,
  onTest,
  proxySelection,
}: {
  rules: OutboundRule[];
  recognitionRules: RecognitionRule[];
  groups: ProxyGroup[];
  onAdd: () => void;
  onEdit: (rule: OutboundRule) => void;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (rule: OutboundRule) => void;
  onPreview: () => void;
  onTest: () => void;
  proxySelection?: string;
}) {
  const text = useMessages(messages);
  const { language } = useLanguage();
  const recognitionByID = new Map(recognitionRules.map((rule) => [rule.id, rule]));
  const groupByID = new Map(groups.map((group) => [group.id, group]));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
            <Radio className="h-4.5 w-4.5 text-primary" />
            {text.outboundTitle}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {text.outboundDescription}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onTest}>
            <Route className="h-3.5 w-3.5" />
            {text.outboundTest}
          </Button>
          <Button variant="outline" size="sm" onClick={onPreview}>
            <Eye className="h-3.5 w-3.5" />
            {text.previewYaml}
          </Button>
          <Button size="sm" onClick={onAdd} disabled={recognitionRules.length === 0}>
            <Plus className="h-4 w-4" />
            {text.addOutbound}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rules.map((rule) => {
          const recognition = recognitionByID.get(rule.recognition_id);
          const group = groupByID.get(rule.group_id);
          const builtinTarget = builtinOutboundTarget(rule.group_id);
          return (
            <div key={rule.id} className={cn("rounded-2xl border border-border/60 bg-card/60 p-4", !rule.enabled && "opacity-55")}>
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="font-mono text-[10px]">{text.outboundTitle}</Badge>
                <Switch checked={rule.enabled} onCheckedChange={(enabled) => onToggle(rule.id, enabled)} />
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-[11px] text-muted-foreground">{text.recognitionTitle}</div>
                  <div className="mt-1 truncate text-sm font-semibold">{recognition?.name ?? text.deletedRecognition}</div>
                  {recognition && <div className="mt-1 text-[11px] text-muted-foreground">{kindLabel(recognition.kind, text)} · {text.priorityBadge.replace("{value}", String(recognition.priority))}</div>}
                </div>
                <div className="flex items-center gap-2 text-primary"><ArrowRight className="h-4 w-4" /><span className="text-xs">{builtinTarget ? text.builtinHandling : text.groupHandling}</span></div>
                <div>
                  <div className="text-[11px] text-muted-foreground">{text.outboundTarget}</div>
                  <div className="mt-1 truncate text-sm font-semibold text-primary">{builtinTarget ? `${text[builtinTarget.nameKey]} (${builtinTarget.target})` : group?.name ?? text.deletedGroup}</div>
                  {builtinTarget ? <div className="mt-1 text-[11px] text-muted-foreground">{builtinTarget.target === "PROXY" ? text.currentSelection.replace("{selection}", proxySelectionLabel(proxySelection, text)) : text[builtinTarget.descriptionKey]}</div> : group && <div className="mt-1 text-[11px] text-muted-foreground">{proxyGroupTypeLabel(group.type, language)} · {group.member_mode === "manual" ? text.manualNodeCount.replace("{count}", String(group.node_ids.length)) : text.groupStrategy}</div>}
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-1 border-t border-border/40 pt-3">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onEdit(rule)}><Pencil className="h-3.5 w-3.5" /> {text.edit}</Button>
                <Button variant="ghost" size="iconSm" title={text.removeOutbound} onClick={() => onDelete(rule)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button>
              </div>
            </div>
          );
        })}
      </div>

      {rules.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 py-12 text-center">
          <Radio className="mx-auto mb-2 h-10 w-10 text-muted-foreground/40" />
          <h4 className="text-sm font-semibold">{text.noOutbound}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{text.noOutboundDescription}</p>
        </div>
      )}
    </div>
  );
}

export default function RulesPage() {
  const text = useMessages(messages);
  const { language } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const activeTab = ["recognition", "groups", "outbound"].includes(searchParams.get("tab") ?? "")
    ? searchParams.get("tab")!
    : "recognition";

  const recognitionQuery = useQuery({
    queryKey: ["recognitionRules"],
    queryFn: () => api.get<RecognitionRule[]>("/api/recognition-rules"),
  });
  const outboundQuery = useQuery({
    queryKey: ["outboundRules"],
    queryFn: () => api.get<OutboundRule[]>("/api/outbound-rules"),
  });
  const groupsQuery = useQuery({
    queryKey: ["groups"],
    queryFn: () => api.get<ProxyGroup[]>("/api/groups"),
  });
  const proxiesQuery = useQuery({
    queryKey: ["proxies"],
    queryFn: () => mihomo.proxies(),
    refetchInterval: 10_000,
  });

  const [recognitionDialogOpen, setRecognitionDialogOpen] = useState(false);
  const [editingRecognition, setEditingRecognition] = useState<RecognitionRule | null>(null);
  const [recognitionName, setRecognitionName] = useState("");
  const [recognitionKind, setRecognitionKind] = useState("DOMAIN-SUFFIX");
  const [conditionsText, setConditionsText] = useState("");
  const [recognitionSourceURL, setRecognitionSourceURL] = useState("");
  const [recognitionSourceBehavior, setRecognitionSourceBehavior] = useState("domain");
  const [recognitionSourceInterval, setRecognitionSourceInterval] = useState(86400);
  const [recognitionPriority, setRecognitionPriority] = useState(0);
  const [recognitionEnabled, setRecognitionEnabled] = useState(true);

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<"url" | "yaml">("url");
  const [importURL, setImportURL] = useState("");
  const [importName, setImportName] = useState("");
  const [importBehavior, setImportBehavior] = useState("domain");
  const [importInterval, setImportInterval] = useState(86400);
  const [importPriority, setImportPriority] = useState(0);
  const [importEnabled, setImportEnabled] = useState(true);
  const [importYAML, setImportYAML] = useState("");

  const [geoPresetDialogOpen, setGeoPresetDialogOpen] = useState(false);
  const [geoPresetCatalog, setGeoPresetCatalog] = useState<GeoRecognitionPresetCatalog | null>(null);
  const [selectedGeoPresetIDs, setSelectedGeoPresetIDs] = useState<string[]>([]);
  const [quickGenerateDialogOpen, setQuickGenerateDialogOpen] = useState(false);

  const [outboundDialogOpen, setOutboundDialogOpen] = useState(false);
  const [editingOutbound, setEditingOutbound] = useState<OutboundRule | null>(null);
  const [outboundRecognitionIDs, setOutboundRecognitionIDs] = useState<number[]>([]);
  const [outboundGroupID, setOutboundGroupID] = useState(0);
  const [outboundEnabled, setOutboundEnabled] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [outboundTestOpen, setOutboundTestOpen] = useState(false);
  const [outboundTestTarget, setOutboundTestTarget] = useState("");

  const previewQuery = useQuery({
    queryKey: ["configPreview"],
    queryFn: () => api.get<GenResult>("/api/config/preview"),
    enabled: previewOpen,
  });

  const recognitionRules = recognitionQuery.data ?? [];
  const outboundRules = outboundQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const importYAMLIsRuleFile = Boolean(importYAML.trim()) && !/^\s*rule-providers\s*:/m.test(importYAML);

  const reportAutoApply = (savedMessage: string, result: AutoApplyResponse) => {
    if (result.apply_error) {
      toast.warning(text.applyFailed.replace("{message}", savedMessage));
    } else {
      toast.success(text.applied.replace("{message}", savedMessage).replace("{result}", autoApplyResultMessage(result.apply_result, language)));
    }
    qc.invalidateQueries({ queryKey: ["config-pending"] });
  };

  const saveRecognition = useMutation({
    mutationFn: (rules: RecognitionRule[]) => api.put<AutoApplyResponse>("/api/recognition-rules", rules),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recognitionRules"] });
      setRecognitionDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const saveOutbound = useMutation({
    mutationFn: (rules: OutboundRule[]) => api.put<AutoApplyResponse>("/api/outbound-rules", rules),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outboundRules"] });
      setOutboundDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const simulateOutbound = useMutation({
    mutationFn: (target: string) => api.post<OutboundSimulation>("/api/outbound-rules/simulate", { target }),
    onError: (error: any) => toast.error(error.message),
  });
  const previewRecognitionImport = useMutation({
    mutationFn: () => api.post<RecognitionRuleImportResponse>("/api/recognition-rules/import", {
      content: importYAML,
      url: importURL,
      name: importName,
      behavior: importBehavior,
      interval: Number(importInterval) || 0,
      priority: Number(importPriority) || 0,
      enabled: importEnabled,
      preview: true,
    }),
    onError: (error: any) => toast.error(error.message),
  });
  const importRecognition = useMutation({
    mutationFn: () => api.post<RecognitionRuleImportResponse>("/api/recognition-rules/import", importMode === "url"
      ? {
          url: importURL,
          name: importName,
          behavior: importBehavior,
          interval: Number(importInterval) || 0,
          priority: Number(importPriority) || 0,
          enabled: importEnabled,
        }
      : {
          content: importYAML,
          url: importURL,
          name: importName,
          behavior: importBehavior,
          interval: Number(importInterval) || 0,
          priority: Number(importPriority) || 0,
          enabled: importEnabled,
        }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recognitionRules"] });
      setImportDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const loadGeoPresets = useMutation({
    mutationFn: () => api.get<GeoRecognitionPresetCatalog>("/api/recognition-rules/geo-presets"),
    onSuccess: (catalog) => {
      setGeoPresetCatalog(catalog);
      setSelectedGeoPresetIDs(catalog.presets.filter((preset) => preset.available).map((preset) => preset.id));
      setGeoPresetDialogOpen(true);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const generateGeoRecognition = useMutation({
    mutationFn: () => api.post<GeoRecognitionGenerationResponse>("/api/recognition-rules/generate-geo", { preset_ids: selectedGeoPresetIDs }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["recognitionRules"] });
      qc.invalidateQueries({ queryKey: ["config-pending"] });
      qc.invalidateQueries({ queryKey: ["configPreview"] });
      if (result.count > 0) {
        const skipped = result.skipped.length ? text.skippedCount.replace("{count}", String(result.skipped.length)) : "";
        reportAutoApply(text.geoGenerated.replace("{count}", String(result.count)).replace("{skipped}", skipped), result);
      } else {
        toast.info(text.noGeoAdded.replace("{count}", String(result.skipped.length)));
      }
      setGeoPresetDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const quickGenerateGeoRouting = useMutation({
    mutationFn: () => api.post<QuickGeoRoutingGenerationResponse>("/api/recognition-rules/generate-geo-routing"),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["recognitionRules"] });
      qc.invalidateQueries({ queryKey: ["outboundRules"] });
      qc.invalidateQueries({ queryKey: ["geo-status"] });
      qc.invalidateQueries({ queryKey: ["config-pending"] });
      qc.invalidateQueries({ queryKey: ["configPreview"] });
      if (result.count > 0) {
        const skipped = result.skipped.length ? text.skippedExisting.replace("{count}", String(result.skipped.length)) : "";
        reportAutoApply(text.quickGeneratedResult.replace("{rules}", String(result.count)).replace("{mappings}", String(result.mappings.length)).replace("{skipped}", skipped), result);
      } else {
        const skipped = result.skipped.length ? text.skippedExisting.replace("{count}", String(result.skipped.length)) : "";
        toast.info(text.noQuickAdded.replace("{skipped}", skipped));
      }
    },
    onError: (error: any) => toast.error(error.message),
  });

  const mappedRecognitionIDs = useMemo(
    () => new Set(outboundRules.map((rule) => rule.recognition_id)),
    [outboundRules],
  );

  const openAddRecognition = () => {
    setEditingRecognition(null);
    setRecognitionName("");
    setRecognitionKind("DOMAIN-SUFFIX");
    setConditionsText("");
    setRecognitionSourceURL("");
    setRecognitionSourceBehavior("domain");
    setRecognitionSourceInterval(86400);
    setRecognitionPriority(0);
    setRecognitionEnabled(true);
    setRecognitionDialogOpen(true);
  };

  const openEditRecognition = (rule: RecognitionRule) => {
    setEditingRecognition(rule);
    setRecognitionName(rule.name);
    setRecognitionKind(rule.kind);
    setConditionsText(rule.conditions.join("\n"));
    setRecognitionSourceURL(rule.source_url ?? "");
    setRecognitionSourceBehavior(rule.source_behavior ?? "domain");
    setRecognitionSourceInterval(rule.source_interval ?? 86400);
    setRecognitionPriority(rule.priority);
    setRecognitionEnabled(rule.enabled);
    setRecognitionDialogOpen(true);
  };

  const persistRecognition = async () => {
    const isRemoteSource = recognitionKind === "RULE-SET";
    const next: RecognitionRule = {
      id: editingRecognition?.id ?? -Date.now(),
      name: recognitionName.trim(),
      kind: recognitionKind,
      conditions: isRemoteSource ? [] : conditionsText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      source_url: isRemoteSource ? recognitionSourceURL.trim() : undefined,
      source_behavior: isRemoteSource ? recognitionSourceBehavior as "domain" | "ipcidr" | "classical" : undefined,
      source_interval: isRemoteSource ? Number(recognitionSourceInterval) || 0 : undefined,
      priority: Number(recognitionPriority) || 0,
      enabled: recognitionEnabled,
    };
    if (!next.name || (next.kind !== "MATCH" && !isRemoteSource && next.conditions.length === 0) || (isRemoteSource && !next.source_url)) {
      toast.error(isRemoteSource ? text.remoteRequired : text.conditionsRequired);
      return;
    }
    const rules = editingRecognition
      ? recognitionRules.map((rule) => (rule.id === editingRecognition.id ? next : rule))
      : [...recognitionRules, next];
    const result = await saveRecognition.mutateAsync(rules);
    reportAutoApply(editingRecognition ? text.recognitionUpdated : text.recognitionCreated, result);
  };

  const openRecognitionImport = () => {
    setImportMode("url");
    setImportURL("");
    setImportName("");
    setImportBehavior("domain");
    setImportInterval(86400);
    setImportPriority(0);
    setImportEnabled(true);
    setImportYAML("");
    previewRecognitionImport.reset();
    setImportDialogOpen(true);
  };

  const openGeoPresetGenerator = () => {
    loadGeoPresets.mutate();
  };

  const toggleGeoPreset = (id: string, checked: boolean) => {
    setSelectedGeoPresetIDs((current) => checked
      ? [...current, id]
      : current.filter((item) => item !== id));
  };

  const persistRecognitionImport = async () => {
    const result = await importRecognition.mutateAsync();
    reportAutoApply(text.importedResult.replace("{count}", String(result.count)), result);
  };

  const deleteRecognition = async (rule: RecognitionRule) => {
    if (!confirm(text.confirmRemoveRecognition.replace("{name}", rule.name))) return;
    const result = await saveRecognition.mutateAsync(recognitionRules.filter((item) => item.id !== rule.id));
    reportAutoApply(text.recognitionDeleted, result);
  };

  const toggleRecognition = (id: number, enabled: boolean) => {
    const rules = recognitionRules.map((rule) => (rule.id === id ? { ...rule, enabled } : rule));
    void saveRecognition.mutateAsync(rules)
      .then((result) => reportAutoApply(enabled ? text.recognitionEnabled : text.recognitionDisabled, result))
      .catch(() => undefined);
  };

  const openAddOutbound = () => {
    setEditingOutbound(null);
    setOutboundRecognitionIDs([]);
    setOutboundGroupID(0);
    setOutboundEnabled(true);
    setOutboundDialogOpen(true);
  };

  const openEditOutbound = (rule: OutboundRule) => {
    setEditingOutbound(rule);
    setOutboundRecognitionIDs([rule.recognition_id]);
    setOutboundGroupID(rule.group_id);
    setOutboundEnabled(rule.enabled);
    setOutboundDialogOpen(true);
  };

  const availableRecognitionRules = recognitionRules.filter(
    (rule) => !mappedRecognitionIDs.has(rule.id) || rule.id === editingOutbound?.recognition_id,
  );

  const persistOutbound = async () => {
    if (outboundRecognitionIDs.length === 0 || !outboundGroupID) {
      toast.error(text.outboundRequired);
      return;
    }
    const selectedIDs = editingOutbound ? [outboundRecognitionIDs[0]] : outboundRecognitionIDs;
    const next = selectedIDs.map((recognitionID, index): OutboundRule => ({
      id: editingOutbound?.id ?? -Date.now() - index,
      recognition_id: recognitionID,
      group_id: outboundGroupID,
      enabled: outboundEnabled,
    }));
    const rules = editingOutbound
      ? outboundRules.map((rule) => (rule.id === editingOutbound.id ? next[0] : rule))
      : [...outboundRules, ...next];
    const result = await saveOutbound.mutateAsync(rules);
    reportAutoApply(editingOutbound ? text.outboundUpdated : text.outboundCreated.replace("{count}", String(next.length)), result);
  };

  const deleteOutbound = async (rule: OutboundRule) => {
    if (!confirm(text.confirmRemoveOutbound)) return;
    const result = await saveOutbound.mutateAsync(outboundRules.filter((item) => item.id !== rule.id));
    reportAutoApply(text.outboundDeleted, result);
  };

  const toggleOutbound = (id: number, enabled: boolean) => {
    const rules = outboundRules.map((rule) => (rule.id === id ? { ...rule, enabled } : rule));
    void saveOutbound.mutateAsync(rules)
      .then((result) => reportAutoApply(enabled ? text.outboundEnabled : text.outboundDisabled, result))
      .catch(() => undefined);
  };

  const toggleOutboundRecognition = (id: number, checked: boolean) => {
    setOutboundRecognitionIDs((current) => checked
      ? [...current, id]
      : current.filter((item) => item !== id));
  };

  return (
    <div className="space-y-5">
      <Tabs value={activeTab} onValueChange={(tab) => setSearchParams({ tab }, { replace: true })}>
        <TabsList className="grid h-auto w-full grid-cols-3 p-1">
          <TabsTrigger value="recognition" className="gap-2"><ScrollText className="h-4 w-4" />{text.recognitionTab.replace("{count}", String(recognitionRules.length))}</TabsTrigger>
          <TabsTrigger value="groups" className="gap-2"><Layers className="h-4 w-4" />{text.groupsTab.replace("{count}", String(groups.length))}</TabsTrigger>
          <TabsTrigger value="outbound" className="gap-2"><Radio className="h-4 w-4" />{text.outboundTab.replace("{count}", String(outboundRules.length))}</TabsTrigger>
        </TabsList>

        <TabsContent value="recognition">
          <RecognitionRulesPanel
            rules={recognitionRules}
            mappedRecognitionIDs={mappedRecognitionIDs}
            onAdd={openAddRecognition}
            onImport={openRecognitionImport}
            onQuickGenerate={() => setQuickGenerateDialogOpen(true)}
            quickGenerating={quickGenerateGeoRouting.isPending}
            onEdit={openEditRecognition}
            onToggle={toggleRecognition}
            onDelete={deleteRecognition}
          />
        </TabsContent>
        <TabsContent value="groups"><GroupsPanel embedded /></TabsContent>
        <TabsContent value="outbound">
          <OutboundRulesPanel
            rules={outboundRules}
            recognitionRules={recognitionRules}
            groups={groups}
            onAdd={openAddOutbound}
            onEdit={openEditOutbound}
            onToggle={toggleOutbound}
            onDelete={deleteOutbound}
            onPreview={() => setPreviewOpen(true)}
            onTest={() => { simulateOutbound.reset(); setOutboundTestOpen(true); }}
            proxySelection={proxiesQuery.data?.proxies?.PROXY?.now}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={recognitionDialogOpen} onOpenChange={setRecognitionDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRecognition ? text.editRecognitionTitle : text.newRecognitionTitle}</DialogTitle>
            <DialogDescription>{text.recognitionDialogDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label>{text.name}</Label><Input value={recognitionName} onChange={(event) => setRecognitionName(event.target.value)} placeholder={text.namePlaceholder} /></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{text.recognitionScope}</Label>
                <Select value={recognitionKind} onChange={(event) => setRecognitionKind(event.target.value)}>
                  {RECOGNITION_KINDS.map((kind) => <option key={kind} value={kind}>{kindLabel(kind, text)}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5"><Label>{text.priority}</Label><Input type="number" value={recognitionPriority} onChange={(event) => setRecognitionPriority(Number(event.target.value))} /><p className="text-[11px] text-muted-foreground">{text.priorityHint}</p></div>
            </div>
            {recognitionKind === "RULE-SET" ? (
              <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">{text.remoteHint}</p>
                <div className="space-y-1.5"><Label>{text.yamlSourceUrl}</Label><Input value={recognitionSourceURL} onChange={(event) => setRecognitionSourceURL(event.target.value)} placeholder="https://example.com/rules.yaml" /></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label>{text.behavior}</Label><Select value={recognitionSourceBehavior} onChange={(event) => setRecognitionSourceBehavior(event.target.value)}><option value="domain">{text.behaviorDomain}</option><option value="ipcidr">{text.behaviorIpCidr}</option><option value="classical">{text.behaviorClassical}</option></Select></div>
                  <div className="space-y-1.5"><Label>{text.intervalSeconds}</Label><Input type="number" min="1" value={recognitionSourceInterval} onChange={(event) => setRecognitionSourceInterval(Number(event.target.value))} /></div>
                </div>
              </div>
            ) : recognitionKind !== "MATCH" ? (
              <div className="space-y-1.5">
                <Label>{text.conditions}</Label>
                <Textarea value={conditionsText} onChange={(event) => setConditionsText(event.target.value)} className="min-h-36 font-mono text-xs" placeholder={recognitionKind === "DOMAIN-SUFFIX" ? "example.com\ntracker.example\nprivate.example" : text.conditionPlaceholder} />
              </div>
            ) : <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">{text.matchHint}</div>}
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 p-3"><div><div className="text-xs font-semibold">{text.enableRecognition}</div><div className="text-[11px] text-muted-foreground">{text.enableRecognitionHint}</div></div><Switch checked={recognitionEnabled} onCheckedChange={setRecognitionEnabled} /></div>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setRecognitionDialogOpen(false)}>{text.cancel}</Button><Button size="sm" onClick={persistRecognition} disabled={saveRecognition.isPending}>{saveRecognition.isPending ? text.saving : text.saveRecognition}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{text.importDialogTitle}</DialogTitle>
            <DialogDescription>{text.importDialogDescription}</DialogDescription>
          </DialogHeader>
          <Tabs value={importMode} onValueChange={(value) => { setImportMode(value as "url" | "yaml"); previewRecognitionImport.reset(); }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="url">{text.singleYamlUrl}</TabsTrigger>
              <TabsTrigger value="yaml">{text.pasteYaml}</TabsTrigger>
            </TabsList>
            <TabsContent value="url" className="space-y-4 py-3">
              <div className="space-y-1.5"><Label>{text.yamlFileUrl}</Label><Input value={importURL} onChange={(event) => setImportURL(event.target.value)} placeholder="https://raw.githubusercontent.com/.../apple.yaml" /></div>
              <div className="space-y-1.5"><Label>{text.optionalName}</Label><Input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder={text.optionalNameHint} /></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>{text.behavior}</Label><Select value={importBehavior} onChange={(event) => setImportBehavior(event.target.value)}><option value="domain">{text.behaviorDomain}</option><option value="ipcidr">{text.behaviorIpCidr}</option><option value="classical">{text.behaviorClassical}</option></Select></div>
                <div className="space-y-1.5"><Label>{text.intervalSeconds}</Label><Input type="number" min="1" value={importInterval} onChange={(event) => setImportInterval(Number(event.target.value))} /></div>
              </div>
            </TabsContent>
            <TabsContent value="yaml" className="space-y-3 py-3">
              <div className="space-y-1.5"><Label>{text.yamlConfig}</Label><Textarea value={importYAML} onChange={(event) => { setImportYAML(event.target.value); previewRecognitionImport.reset(); }} className="min-h-52 font-mono text-xs" placeholder={text.yamlPlaceholder} /></div>
              {importYAMLIsRuleFile && <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">{text.payloadDetected}</p>
                <div className="space-y-1.5"><Label>{text.ruleFileUrl}</Label><Input value={importURL} onChange={(event) => { setImportURL(event.target.value); previewRecognitionImport.reset(); }} placeholder="https://github.com/.../blob/.../github.yaml" /></div>
                <div className="space-y-1.5"><Label>{text.optionalName}</Label><Input value={importName} onChange={(event) => { setImportName(event.target.value); previewRecognitionImport.reset(); }} placeholder={text.optionalNameHint} /></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label>{text.behavior}</Label><Select value={importBehavior} onChange={(event) => { setImportBehavior(event.target.value); previewRecognitionImport.reset(); }}><option value="domain">{text.behaviorDomain}</option><option value="ipcidr">{text.behaviorIpCidr}</option><option value="classical">{text.behaviorClassical}</option></Select></div>
                  <div className="space-y-1.5"><Label>{text.intervalSeconds}</Label><Input type="number" min="1" value={importInterval} onChange={(event) => { setImportInterval(Number(event.target.value)); previewRecognitionImport.reset(); }} /></div>
                </div>
              </div>}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/35 p-3">
                <div className="text-xs text-muted-foreground">{text.importParseHint}</div>
                <Button type="button" variant="outline" size="sm" onClick={() => previewRecognitionImport.mutate()} disabled={!importYAML.trim() || (importYAMLIsRuleFile && !importURL.trim()) || previewRecognitionImport.isPending}><Eye className="h-3.5 w-3.5" />{previewRecognitionImport.isPending ? text.parsing : text.parseConfig}</Button>
              </div>
              {previewRecognitionImport.data && <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-3 text-xs text-emerald-700 dark:text-emerald-300">{text.parsedResult.replace("{count}", String(previewRecognitionImport.data.count)).replace("{names}", previewRecognitionImport.data.rules.map((rule) => rule.name).join(language === "zh-CN" ? "、" : ", "))}</div>}
            </TabsContent>
          </Tabs>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>{text.priority}</Label><Input type="number" value={importPriority} onChange={(event) => setImportPriority(Number(event.target.value))} /><p className="text-[11px] text-muted-foreground">{text.importPriorityHint}</p></div>
            <div className="flex items-center justify-between self-end rounded-xl border border-border/60 bg-muted/40 p-3"><div><div className="text-xs font-semibold">{text.enableAfterImport}</div><div className="text-[11px] text-muted-foreground">{text.enableAfterImportHint}</div></div><Switch checked={importEnabled} onCheckedChange={setImportEnabled} /></div>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setImportDialogOpen(false)}>{text.cancel}</Button><Button size="sm" onClick={persistRecognitionImport} disabled={importRecognition.isPending || (importMode === "url" ? !importURL.trim() : !previewRecognitionImport.data)}>{importRecognition.isPending ? text.importing : text.importRecognition}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={quickGenerateDialogOpen} onOpenChange={setQuickGenerateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{text.quickGenerate}</DialogTitle>
            <DialogDescription>{text.quickDialogDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Button
              variant="outline"
              className="h-auto items-start justify-start gap-3 whitespace-normal p-4 text-left"
              onClick={() => { setQuickGenerateDialogOpen(false); openGeoPresetGenerator(); }}
              disabled={loadGeoPresets.isPending}
            >
              <WandSparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="space-y-1">
                <span className="block text-sm font-semibold">{text.geoRecognitionOption}</span>
                <span className="block text-xs font-normal text-muted-foreground">{text.geoRecognitionOptionDescription}</span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto items-start justify-start gap-3 whitespace-normal p-4 text-left"
              onClick={() => { setQuickGenerateDialogOpen(false); quickGenerateGeoRouting.mutate(); }}
              disabled={quickGenerateGeoRouting.isPending}
            >
              <WandSparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="space-y-1">
                <span className="block text-sm font-semibold">{text.commonConfigOption}</span>
                <span className="block text-xs font-normal text-muted-foreground">{text.commonConfigOptionDescription}</span>
              </span>
            </Button>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setQuickGenerateDialogOpen(false)}>{text.cancel}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={geoPresetDialogOpen} onOpenChange={setGeoPresetDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{text.geoDialogTitle}</DialogTitle>
            <DialogDescription>{text.geoDialogDescription}</DialogDescription>
          </DialogHeader>
          {!geoPresetCatalog?.available ? (
            <div className="space-y-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{geoPresetCatalog?.message || text.noGeoData}</p>
              <p className="text-xs text-muted-foreground">{text.geoRequiredHint}</p>
              <Button size="sm" onClick={() => { setGeoPresetDialogOpen(false); navigate("/geo"); }}><WandSparkles className="h-4 w-4" />{text.goToGeo}</Button>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">{text.geoSelectionHint}</div>
              {(["GEOIP", "GEOSITE"] as const).map((kind) => {
                const presets = geoPresetCatalog.presets.filter((preset) => preset.kind === kind);
                return <div key={kind} className="space-y-2">
                  <div className="text-xs font-semibold">{kindLabel(kind, text)}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {presets.map((preset) => {
                      const checked = selectedGeoPresetIDs.includes(preset.id);
                      return <label key={preset.id} className={cn("flex cursor-pointer items-start gap-2 rounded-xl border p-3 transition-colors", preset.available ? "border-border/60 bg-muted/35 hover:border-primary/40" : "cursor-not-allowed border-border/40 bg-muted/20 opacity-55")}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={checked} disabled={!preset.available} onChange={(event) => toggleGeoPreset(preset.id, event.target.checked)} />
                        <span className="min-w-0"><span className="block text-xs font-semibold">{geoPresetLabel(preset.id, preset.name, text)}</span><span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{preset.kind},{preset.condition}</span>{!preset.available && <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-300">{preset.reason}</span>}</span>
                      </label>;
                    })}
                  </div>
                </div>;
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setGeoPresetDialogOpen(false)}>{text.cancel}</Button>
            {geoPresetCatalog?.available && <Button size="sm" onClick={() => generateGeoRecognition.mutate()} disabled={selectedGeoPresetIDs.length === 0 || generateGeoRecognition.isPending}>{generateGeoRecognition.isPending ? text.generating : text.generateRules.replace("{count}", String(selectedGeoPresetIDs.length))}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={outboundDialogOpen} onOpenChange={setOutboundDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingOutbound ? text.editOutboundTitle : text.newOutboundTitle}</DialogTitle><DialogDescription>{editingOutbound ? text.editOutboundDescription : text.newOutboundDescription}</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{text.recognitionTitle}</Label>
              {editingOutbound ? (
                <Select value={String(outboundRecognitionIDs[0] ?? 0)} onChange={(event) => setOutboundRecognitionIDs([Number(event.target.value)])}>
                  <option value="0">{text.selectRecognition}</option>
                  {availableRecognitionRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name} ({rule.kind}, {text.priorityBadge.replace("{value}", String(rule.priority))})</option>)}
                </Select>
              ) : (
                <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-border/60 bg-muted/25 p-2.5">
                  {availableRecognitionRules.map((rule) => {
                    const checked = outboundRecognitionIDs.includes(rule.id);
                    return <label key={rule.id} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors", checked ? "border-primary/40 bg-primary/8" : "border-transparent hover:bg-muted/60")}>
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={checked} onChange={(event) => toggleOutboundRecognition(rule.id, event.target.checked)} />
                      <span className="min-w-0"><span className="block truncate text-xs font-semibold">{rule.name}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{kindLabel(rule.kind, text)} · {text.priorityBadge.replace("{value}", String(rule.priority))}</span></span>
                    </label>;
                  })}
                  {availableRecognitionRules.length === 0 && <div className="p-3 text-center text-xs text-muted-foreground">{text.noUnmappedRecognition}</div>}
                </div>
              )}
              {!editingOutbound && <p className="text-[11px] text-muted-foreground">{text.selectedRecognition.replace("{count}", String(outboundRecognitionIDs.length))}</p>}
            </div>
            <div className="space-y-1.5"><Label>{text.outboundTarget}</Label><Select value={String(outboundGroupID)} onChange={(event) => setOutboundGroupID(Number(event.target.value))}><option value="0">{text.selectOutbound}</option><optgroup label={text.builtinTargets}>{BUILTIN_OUTBOUND_TARGETS.map((target) => <option key={target.id} value={target.id}>{text[target.nameKey]} ({target.target})</option>)}</optgroup><optgroup label={text.proxyGroups}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name} ({proxyGroupTypeLabel(group.type, language)}{group.enabled ? "" : text.disabledSuffix})</option>)}</optgroup></Select></div>
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 p-3"><div><div className="text-xs font-semibold">{text.enableOutbound}</div><div className="text-[11px] text-muted-foreground">{text.enableOutboundHint}</div></div><Switch checked={outboundEnabled} onCheckedChange={setOutboundEnabled} /></div>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setOutboundDialogOpen(false)}>{text.cancel}</Button><Button size="sm" onClick={persistOutbound} disabled={saveOutbound.isPending}>{saveOutbound.isPending ? text.saving : text.saveOutbound}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={outboundTestOpen} onOpenChange={(open) => { setOutboundTestOpen(open); if (!open) simulateOutbound.reset(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{text.outboundTest}</DialogTitle>
            <DialogDescription>{text.outboundTestDescription}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4 py-2" onSubmit={(event) => { event.preventDefault(); if (!outboundTestTarget.trim()) { toast.error(text.targetRequired); return; } simulateOutbound.mutate(outboundTestTarget); }}>
            <div className="space-y-1.5">
              <Label htmlFor="outbound-test-target">{text.accessTarget}</Label>
              <Input id="outbound-test-target" value={outboundTestTarget} onChange={(event) => setOutboundTestTarget(event.target.value)} placeholder={text.targetPlaceholder} autoFocus />
            </div>
            {simulateOutbound.data && (
              <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-foreground">{simulateOutbound.data.target}</span>
                  <Badge variant={simulateOutbound.data.certain ? "success" : "warning"}>{simulateOutbound.data.certain ? text.certain : text.uncertain}</Badge>
                </div>
                <div className="grid gap-2 border-y border-primary/15 py-3 sm:grid-cols-[76px_minmax(0,1fr)]">
                  <span className="text-muted-foreground">{text.matchedRule}</span>
                  <span className="min-w-0 font-medium text-foreground">{simulateOutbound.data.rule_name}<span className="ml-1 text-muted-foreground">({simulateOutbound.data.rule_kind}, {text.priorityBadge.replace("{value}", String(simulateOutbound.data.rule_priority))})</span>{simulateOutbound.data.rule_condition && <span className="mt-1 block break-all font-mono text-[11px] text-muted-foreground">{text.condition}: {simulateOutbound.data.rule_condition}</span>}</span>
                  <span className="text-muted-foreground">{text.outboundTarget}</span>
                  <span className="break-all font-medium text-primary">{simulateOutbound.data.outbound_target}</span>
                </div>
                <div className="space-y-1.5">
                  <div className="text-muted-foreground">{text.simulatedRoute}</div>
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-primary">{simulateOutbound.data.chain.map((item, index) => <span key={`${item}-${index}`} className="contents">{index > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}<span className="rounded-md bg-card/70 px-2 py-1">{item}</span></span>)}</div>
                </div>
                {simulateOutbound.data.limitations.length > 0 && <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">{simulateOutbound.data.limitations.map((item) => <div key={item}>· {item}</div>)}</div>}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setOutboundTestOpen(false)}>{text.close}</Button>
              <Button type="submit" size="sm" disabled={simulateOutbound.isPending}>{simulateOutbound.isPending ? text.simulating : text.startTest}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl"><DialogHeader><DialogTitle>{text.previewTitle}</DialogTitle><DialogDescription>{text.previewDescription}</DialogDescription></DialogHeader><div className="my-2 flex-1 overflow-hidden rounded-xl border border-border/80">{previewQuery.data ? <CodeMirror value={previewQuery.data.yaml} height="450px" extensions={[yaml()]} theme={oneDark} readOnly /> : <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">{text.previewGenerating}</div>}</div></DialogContent>
      </Dialog>
    </div>
  );
}
