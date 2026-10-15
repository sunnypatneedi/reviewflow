"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group z-toast"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-fill-inverse group-[.toaster]:text-text-inverse group-[.toaster]:border-transparent group-[.toaster]:shadow-surface group-[.toaster]:rounded-md",
          description: "group-[.toast]:text-text-inverse",
          actionButton:
            "group-[.toast]:bg-text-inverse group-[.toast]:text-fill-inverse",
          cancelButton:
            "group-[.toast]:bg-fill-inverse-hover group-[.toast]:text-text-inverse",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
