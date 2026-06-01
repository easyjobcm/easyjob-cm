"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const AlertDialog = Dialog;
export const AlertDialogTrigger = DialogTrigger;
export const AlertDialogContent = DialogContent;
export const AlertDialogHeader = DialogHeader;
export const AlertDialogTitle = DialogTitle;
export const AlertDialogDescription = DialogDescription;
export const AlertDialogFooter = DialogFooter;

type AlertDialogActionProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function AlertDialogAction(props: AlertDialogActionProps) {
  return <button type="button" {...props} />;
}

type AlertDialogCancelProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function AlertDialogCancel(props: AlertDialogCancelProps) {
  return <button type="button" {...props} />;
}
