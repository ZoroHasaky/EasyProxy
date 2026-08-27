import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { defineMessages, useMessages } from "@/contexts/language";

interface Props {
  children: ReactNode;
  text: {
    title: string;
    unknown: string;
    refresh: string;
  };
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryInner extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught runtime error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-background p-6 text-foreground">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/15 text-destructive mb-4">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-bold">{this.props.text.title}</h2>
          <p className="text-xs text-muted-foreground mt-2 max-w-md text-center font-mono bg-muted/40 p-3 rounded-xl border border-border/60 break-all">
            {this.state.error?.message || this.props.text.unknown}
          </p>
          <Button
            className="mt-6"
            size="sm"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            <RotateCcw className="h-4 w-4" />
            {this.props.text.refresh}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

const messages = defineMessages({
  title: "页面渲染遇到异常",
  unknown: "未知组件运行时异常",
  refresh: "刷新页面",
}, {
  title: "The page encountered an error",
  unknown: "Unknown component runtime error",
  refresh: "Reload Page",
});

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const text = useMessages(messages);
  return <ErrorBoundaryInner text={text}>{children}</ErrorBoundaryInner>;
}
