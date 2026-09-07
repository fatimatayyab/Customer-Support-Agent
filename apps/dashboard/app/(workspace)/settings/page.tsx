"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InlineError } from "@/components/ui/error-state";
import { Field, Input } from "@/components/ui/field";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api";

interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  administrator: "Administrator",
  support_agent: "Support Agent",
};

export default function SettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ user: Me }>("/workspaces/me")
      .then((data) => {
        setMe(data?.user ?? null);
        setName(data?.user?.name ?? "");
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setPasswordError(err instanceof ApiError ? err.message : "Could not load account.");
      });
  }, [router]);

  async function handleSaveName(event: FormEvent) {
    event.preventDefault();
    setSavingName(true);
    setNameError(null);
    try {
      await apiFetch("/workspaces/me", { method: "PATCH", body: JSON.stringify({ name }) });
      showToast("Name updated", "success");
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : "Could not update name.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match.");
      return;
    }
    setChangingPassword(true);
    try {
      await apiFetch("/workspaces/me/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("Password updated", "success");
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Could not change password.");
    } finally {
      setChangingPassword(false);
    }
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-slate-900">Settings</h1>

      <Card>
        <CardHeader title="Profile" />
        <CardBody className="flex flex-col gap-4">
          <form onSubmit={handleSaveName} className="flex flex-col gap-4">
            <Field label="Name" required>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required />
            </Field>
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="font-medium text-slate-700">Email</span>
                <span className="text-slate-500">{me.email}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-medium text-slate-700">Role</span>
                <span className="text-slate-500">{ROLE_LABELS[me.role] ?? me.role}</span>
              </div>
            </div>
            {nameError && <InlineError message={nameError} />}
            <Button type="submit" disabled={savingName} className="self-start">
              {savingName ? "Saving..." : "Save"}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Password" />
        <CardBody className="flex flex-col gap-4">
          <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
            <Field label="Current password" required>
              <Input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="New password" required>
              <Input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <Field label="Confirm new password" required>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            {passwordError && <InlineError message={passwordError} />}
            <Button type="submit" disabled={changingPassword} className="self-start">
              {changingPassword ? "Updating..." : "Update password"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}