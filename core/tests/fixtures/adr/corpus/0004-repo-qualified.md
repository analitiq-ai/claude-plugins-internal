---
schemaVersion: 0.1.0
id: "0004"
title: "Repo qualified"
status: accepted
date: 2026-10-01
deciders: ["@fixture"]
scope: component
reversibility: two-way-door
blastRadius: component
affects:
  - type: path
    pattern: "src/**"
    repo: "acme/other"
---

# ADR-0004: Repo qualified

## Context

A fixture record for the decision check's tests.

## Decision

Repo qualified.

## Consequences

None outside the tests.
