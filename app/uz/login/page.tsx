"use client";

import { LoginForm } from "@/components/overlays/LoginModal";

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-12">
      <div className="bg-card rounded-2xl border p-6">
        <LoginForm />
      </div>
    </div>
  );
}
