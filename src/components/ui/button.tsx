import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Button — 按 design.md §9.1 规格
 * 默认高 32px / 13px 500 / 圆角 6px;小号 28px(表格行内操作)
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] text-[13px] font-medium transition-colors duration-120 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[rgba(13,148,136,0.30)] active:scale-[0.98]",
  {
    variants: {
      variant: {
        // 主按钮:底 #0F766E,hover #115E59
        primary: "bg-primary-700 text-white hover:bg-primary-800",
        // 次按钮:白底,边框 #CBD5E1,文字 #334155
        secondary:
          "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50",
        // 危险:白底,边框 #FCA5A5,文字 #DC2626
        danger:
          "bg-white border border-danger-border text-danger hover:bg-danger-light",
        // 审批通过专用:底 #16A34A
        approve: "bg-success text-white hover:bg-success-dark",
        // 幽灵:无底无边框
        ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
        // 链接:文字 #0D9488
        link: "text-primary-600 hover:underline underline-offset-4 h-auto px-0",
        // 兼容 shadcn 原变体名
        default: "bg-primary-700 text-white hover:bg-primary-800",
        destructive:
          "bg-white border border-danger-border text-danger hover:bg-danger-light",
        outline:
          "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-[12px]",
        lg: "h-9 px-4 text-sm",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** loading 态:左侧 Loader2 旋转并禁用点击 */
  loading?: boolean
}

function Button({
  className,
  variant = "primary",
  size = "default",
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="animate-spin [animation-duration:800ms]" />}
      {children}
    </Comp>
  )
}

export { Button, buttonVariants }
