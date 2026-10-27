\# DevIntel — Project Development



\## Team



| Member | Responsibility |

|---|---|

| Sahil Malik | Backend, database, APIs, impact analysis, health engine, GitHub/AI integration |

| Sanrachana | Application shell, dashboard, requirements, traceability visualization |

| Vedant Chitlangia | Impact UI, task board, health UI, code review, assistant, styling |



\## Development Phases



\### Phase 1 — Problem Analysis \& Architecture

Identified the gap between requirements, implementation evidence, testing and project risks. Finalized DevIntel as an engineering-intelligence platform focused on persistent traceability and change-impact analysis.



\### Phase 2 — Full-Stack Setup

Established the React/Vite frontend, Express backend, MongoDB/Mongoose persistence, environment configuration and API communication.



\### Phase 3 — Authentication \& Data Layer

Implemented JWT authentication, password hashing, protected APIs, security middleware and the project's domain models.



\### Phase 4 — Requirements \& Task Management

Implemented requirements, acceptance criteria, versioning, tasks, Kanban workflow and sprint-related project management.



\### Phase 5 — Requirement Traceability

Connected requirements with tasks, commits, pull requests, source files, tests and findings through persistent traceability links.



\### Phase 6 — Change-Impact Analysis

Implemented the core intelligence engine that compares requirement versions, traverses related artifacts, inspects available evidence and identifies affected artifacts and revalidation requirements.



\### Phase 7 — GitHub \& AI Intelligence

Added GitHub synchronization, code-review analysis and a project assistant. AI-generated suggestions are explicitly separated from verified deterministic findings.



\### Phase 8 — Testing \& Stabilization

Tested the major workflows, fixed discovered issues and validated the requirement-change → impact-analysis → project-health workflow.



\### Phase 9 — Dashboard \& Demonstration

Implemented project health metrics, requirement coverage, traceability coverage, risk indicators, activity information and the ShopSphere demonstration workspace.



\### Phase 10 — Release \& Documentation

Completed production build verification, documentation and the final examiner demonstration workflow.



\## Core Demonstration Workflow



1\. Login to the DevIntel workspace.

2\. Open the ShopSphere project.

3\. Inspect project health and requirement coverage.

4\. Open a requirement such as `REQ-006`.

5\. Inspect its traceability chain.

6\. Modify the requirement.

7\. Run change-impact analysis.

8\. Review affected tasks, files and tests.

9\. Inspect risks and recommended actions.

10\. Revalidate the requirement.

11\. Return to the dashboard and observe the updated project state.

12\. Ask the Project Assistant about the project.



\## Engineering Principle



DevIntel does not treat AI output as ground truth.



Verified findings are based on stored project evidence and deterministic analysis. AI-generated observations are explicitly labelled as suggestions.



\## Current Release



`v1.0.0` — Stable demonstration release.



\## Technology



\- React

\- Vite

\- Tailwind CSS

\- Node.js

\- Express.js

\- MongoDB

\- Mongoose

\- GitHub REST API

\- Configurable LLM integration

