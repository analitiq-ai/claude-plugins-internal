---
schemaVersion: 0.1.0
id: "0003"
title: "Package matcher"
status: accepted
date: 2026-10-01
deciders: ["@fixture"]
scope: component
reversibility: two-way-door
blastRadius: component
affects:
  - type: package
    pattern: "core"
---

# ADR-0003: Package matcher

## Context

A fixture record for the decision check's tests.

## Decision

Package matcher.

## Consequences

None outside the tests.
